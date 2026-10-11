import { ApiError, type PdpClient } from '../api/client.ts'
import {
  disruptionsResponse,
  operationsResponse,
  type TrainOperationJson,
  trainOperation,
} from '../api/schemas.ts'
import type { Budget } from '../cache/budget.ts'
import type { TtlCache } from '../cache/ttlCache.ts'
import { log } from '../log.ts'
import { DAY_MIN, daysBetween } from '../time.ts'
import type { Trip } from './trips.ts'

const MINUTE_MS = 60 * 1000
const MAX_OPERATION_PAGES = 3

/** Live state of one stop. Times are minutes since 00:00 of the train's operating date. */
export interface LiveStop {
  stationId: number
  actualArr: number | undefined
  actualDep: number | undefined
  arrDelay: number | undefined
  depDelay: number | undefined
  cancelled: boolean
  confirmed: boolean
}

export interface LiveTrain {
  /** S not started, P running, C completed, X cancelled, Q partly cancelled. */
  status: string | undefined
  stops: LiveStop[]
}

export interface Disruption {
  type: string | undefined
  message: string
  startStationId: number | undefined
  endStationId: number | undefined
  routes: { scheduleId: number; orderId: number; trainOrderId: number | undefined; operatingDate: string }[]
}

/** Why live data is missing, for a one-line note. */
export type LiveGap = 'budget' | 'unavailable' | 'not-tracked'

export type LiveResult<T> = { ok: true; value: T } | { ok: false; gap: LiveGap }

/**
 * Real-time data: train execution and disruptions. Optional on top of the timetable, so it is
 * skipped when the request budget runs low, and failures never fail the tool call.
 */
export class Live {
  private readonly client: PdpClient
  private readonly cache: TtlCache
  private readonly budget: Budget

  constructor(client: PdpClient, cache: TtlCache, budget: Budget) {
    this.client = client
    this.cache = cache
    this.budget = budget
  }

  /** Live run of one train (1 request, cached 1 min; 6 h once it has arrived). */
  async train(trip: Trip): Promise<LiveResult<LiveTrain>> {
    const order = trip.trainOrderId ?? trip.orderId
    const path = `api/v1/operations/train/${trip.scheduleId}/${order}/${trip.operatingDate}`
    return this.guarded(async () => {
      const body = await this.cache.get(
        `live:${trip.scheduleId}/${order}/${trip.operatingDate}`,
        (b) => (trainOperation.safeParse(b).data?.trainStatus === 'C' ? 6 * 60 * MINUTE_MS : MINUTE_MS),
        () => this.client.getJson(path),
      )
      return toLiveTrain(trainOperation.parse(body))
    })
  }

  /** Live runs of every train at the given stations (1–3 requests, cached 1 min), keyed by `liveKey`. */
  async atStations(stationIds: number[]): Promise<LiveResult<Map<string, LiveTrain>>> {
    const stations = [...new Set(stationIds)].sort((a, b) => a - b).join(',')
    return this.guarded(async () => {
      const body = await this.cache.get(
        `live-stations:${stations}`,
        () => MINUTE_MS,
        async () => {
          const trains: unknown[] = []
          for (let page = 1; page <= MAX_OPERATION_PAGES; page++) {
            const raw = await this.client.getJson('api/v1/operations', {
              stations,
              withPlanned: true,
              page,
              pageSize: 1000,
            })
            const parsed = operationsResponse.parse(raw)
            trains.push(...(parsed.trains ?? []))
            if (!parsed.pagination?.hasNextPage) break
          }
          return { trains }
        },
      )
      const map = new Map<string, LiveTrain>()
      for (const raw of operationsResponse.parse(body).trains ?? []) {
        const live = toLiveTrain(raw)
        map.set(`${raw.scheduleId}/${raw.orderId}/${raw.operatingDate}`, live)
        if (raw.trainOrderId != null)
          map.set(`${raw.scheduleId}/${raw.trainOrderId}/${raw.operatingDate}`, live)
      }
      return map
    })
  }

  /** Disruptions for a date, nationwide (1 request, cached 15 min), filtered locally. */
  async disruptions(date: string): Promise<LiveResult<Disruption[]>> {
    return this.guarded(async () => {
      const body = disruptionsResponse.parse(
        await this.cache.get(
          `disruptions:${date}`,
          () => 15 * MINUTE_MS,
          () =>
            this.client.getJson('api/v1/disruptions', { dateFrom: date, dateTo: date, dictionaries: true }),
        ),
      )
      const types = body.disruptionTypes ?? {}
      return (body.disruptions ?? []).flatMap((d) =>
        d.message
          ? [
              {
                type: (d.disruptionTypeCode && types[d.disruptionTypeCode]) || undefined,
                message: d.message.trim(),
                startStationId: d.startStationId ?? undefined,
                endStationId: d.endStationId ?? undefined,
                routes: (d.affectedRoutes ?? []).map((r) => ({
                  scheduleId: r.scheduleId,
                  orderId: r.orderId,
                  trainOrderId: r.trainOrderId ?? undefined,
                  operatingDate: r.operatingDate,
                })),
              },
            ]
          : [],
      )
    })
  }

  private async guarded<T>(fn: () => Promise<T>): Promise<LiveResult<T>> {
    if (!this.budget.allowsOptional()) return { ok: false, gap: 'budget' }
    try {
      return { ok: true, value: await fn() }
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'not_found') return { ok: false, gap: 'not-tracked' }
      // Auth and quota problems should reach the user like any other tool error.
      if (error instanceof ApiError && (error.kind === 'unauthorized' || error.kind === 'missing_key'))
        throw error
      log.warn('live data unavailable', error)
      return { ok: false, gap: 'unavailable' }
    }
  }
}

/** Key used to match a timetable trip with live data. */
export function liveKey(trip: Trip): string {
  return `${trip.scheduleId}/${trip.trainOrderId ?? trip.orderId}/${trip.operatingDate}`
}

export function affects(d: Disruption, trip: Trip): boolean {
  return d.routes.some(
    (r) =>
      r.scheduleId === trip.scheduleId &&
      r.operatingDate === trip.operatingDate &&
      (r.orderId === trip.orderId || (r.trainOrderId !== undefined && r.trainOrderId === trip.trainOrderId)),
  )
}

function toLiveTrain(raw: TrainOperationJson): LiveTrain {
  const date = raw.operatingDate.slice(0, 10)
  return {
    status: raw.trainStatus ?? undefined,
    stops: (raw.stations ?? []).map((s) => ({
      stationId: s.stationId,
      actualArr: minutesOf(s.actualArrival, date),
      actualDep: minutesOf(s.actualDeparture, date),
      arrDelay: s.arrivalDelayMinutes ?? undefined,
      depDelay: s.departureDelayMinutes ?? undefined,
      cancelled: s.isCancelled === true,
      confirmed: s.isConfirmed === true,
    })),
  }
}

/**
 * "2026-10-12T08:39:00" (Polish local time, no zone) → minutes since 00:00 of `date`.
 * Values with an explicit zone are converted to Polish wall-clock time first.
 */
export function minutesOf(value: string | null | undefined, date: string): number | undefined {
  if (!value) return undefined
  let local = value
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value.slice(10))) {
    const epoch = Date.parse(value)
    if (Number.isNaN(epoch)) return undefined
    local = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Warsaw',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .format(epoch)
      .replace(' ', 'T')
  }
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(local)
  if (!match) return undefined
  return daysBetween(date, match[1] as string) * DAY_MIN + Number(match[2]) * 60 + Number(match[3])
}
