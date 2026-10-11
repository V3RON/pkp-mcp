import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { ApiError } from '../api/client.ts'
import { affects, type Disruption, type LiveTrain } from '../data/live.ts'
import type { ResolvedPlace } from '../data/places.ts'
import { parseRef, type Stop, type Trip, tripRef } from '../data/trips.ts'
import { UserError } from '../errors.ts'
import { formatTrain } from '../format/trainDetails.ts'
import { trainLabel } from '../format/trains.ts'
import { log } from '../log.ts'
import { messages as m } from '../messages.ts'
import { formatClock, formatWarsawDateTime, warsawNow } from '../time.ts'
import type { Context } from './context.ts'
import { text, toolError } from './errors.ts'
import { dateParam, parseDate } from './inputs.ts'
import { gapNote, liveDateOk } from './live.ts'

export function registerTrainDetails(server: McpServer, ctx: Context): void {
  server.registerTool(
    'train_details',
    {
      title: 'Train details',
      description:
        'Stops, platforms, live delay and disruptions of one train, by ref from other tools or by train number.',
      inputSchema: {
        ref: z.string().optional().describe('ref from search_connections or station_board'),
        number: z.string().optional().describe('Train number, e.g. "3510", if no ref'),
        date: dateParam,
        from: z.string().optional().describe('Only show stops from this station'),
        to: z.string().optional().describe('Only show stops up to this station'),
        live: z.boolean().optional().describe('Live delay and disruptions, default true'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        return text(await trainDetails(ctx, input))
      } catch (error) {
        return toolError(error)
      }
    },
  )
}

interface Input {
  ref?: string | undefined
  number?: string | undefined
  date?: string | undefined
  from?: string | undefined
  to?: string | undefined
  live?: boolean | undefined
}

async function trainDetails(ctx: Context, input: Input): Promise<string> {
  const today = warsawNow(ctx.now()).date
  const notes: string[] = []
  // Station names come from the catalogue; with only a ref, nothing else would load it.
  const [{ trip, staleSince }] = await Promise.all([findTrip(ctx, input, today), loadNames(ctx)])
  if (staleSince !== undefined) notes.push(m.staleNote(formatWarsawDateTime(staleSince)))

  const [from, to] = await Promise.all([
    input.from ? ctx.places.resolve(input.from) : undefined,
    input.to ? ctx.places.resolve(input.to) : undefined,
  ])
  const stops = segment(
    trip.stops.filter((s) => s.passenger),
    from,
    to,
  )

  let live: LiveTrain | undefined
  let disruptions: Disruption[] = []
  if (input.live !== false) {
    if (liveDateOk(trip.operatingDate, today)) {
      const [liveResult, disruptionResult] = await Promise.all([
        ctx.live.train(trip),
        ctx.live.disruptions(trip.operatingDate),
      ])
      if (liveResult.ok) live = liveResult.value
      else notes.push(gapNote(liveResult.gap))
      if (disruptionResult.ok) disruptions = disruptionResult.value.filter((d) => affects(d, trip))
    } else {
      // Disruptions are announced ahead, so they are worth checking for future dates too.
      const disruptionResult = await ctx.live.disruptions(trip.operatingDate)
      if (disruptionResult.ok) disruptions = disruptionResult.value.filter((d) => affects(d, trip))
    }
  }

  const nameOf = (id: number) => ctx.places.stationName(id) ?? `#${id}`
  return formatTrain({ trip, stops, live, disruptions, notes, nameOf })
}

async function findTrip(
  ctx: Context,
  input: Input,
  today: string,
): Promise<{ trip: Trip; staleSince: number | undefined }> {
  if (input.ref) {
    const ref = parseRef(input.ref)
    if (!ref) throw new UserError(m.badRef(input.ref))
    const { trip, staleSince } = await ctx.timetables.trip(ref.scheduleId, ref.orderId, ref.operatingDate)
    if (!trip) throw new UserError(m.trainNotRunning(input.ref))
    return { trip, staleSince }
  }
  if (input.number) {
    const date = parseDate(input.date, today)
    const { trips, staleSince } = await ctx.timetables.byNumber(input.number, date)
    const [only, ...others] = trips
    if (!only) throw new UserError(m.trainNotFound(input.number, date))
    if (others.length > 0)
      throw new UserError(
        m.trainAmbiguous(
          input.number,
          trips.slice(0, 5).map((t) => summary(ctx, t)),
        ),
      )
    return { trip: only, staleSince }
  }
  throw new UserError(m.needTrain)
}

async function loadNames(ctx: Context): Promise<void> {
  try {
    await ctx.places.ensureLoaded()
  } catch (error) {
    if (error instanceof ApiError && (error.kind === 'unauthorized' || error.kind === 'missing_key'))
      throw error
    log.warn('station names unavailable; showing IDs', error)
  }
}

/** "IC 3510 (IC) 06:12 Kraków Główny → 08:39 Warszawa Centralna · ref …" for disambiguation. */
function summary(ctx: Context, trip: Trip): string {
  const stops = trip.stops.filter((s) => s.passenger)
  const first = stops[0]
  const last = stops[stops.length - 1]
  const name = (s: Stop | undefined) => (s ? (ctx.places.stationName(s.stationId) ?? `#${s.stationId}`) : '?')
  const dep = first?.dep === undefined ? '' : `${formatClock(first.dep)} `
  const arr = last?.arr === undefined ? '' : `${formatClock(last.arr)} `
  return `${first ? trainLabel(trip, first) : '?'} ${dep}${name(first)} → ${arr}${name(last)} · ref ${tripRef(trip)}`
}

/** Stops from the first stop in `from` to the next stop in `to` (either side optional). */
function segment(stops: Stop[], from: ResolvedPlace | undefined, to: ResolvedPlace | undefined): Stop[] {
  const fromIds = from && new Set(from.stationIds)
  const toIds = to && new Set(to.stationIds)
  const start = fromIds ? stops.findIndex((s) => fromIds.has(s.stationId)) : 0
  if (start < 0) return stops
  const endOffset = toIds ? stops.slice(start + 1).findIndex((s) => toIds.has(s.stationId)) : -1
  return endOffset < 0 ? stops.slice(start) : stops.slice(start, start + 1 + endOffset + 1)
}
