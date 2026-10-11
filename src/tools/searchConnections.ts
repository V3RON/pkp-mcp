import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { Stop, Trip } from '../data/trips.ts'
import { UserError } from '../errors.ts'
import { formatConnections, placeLabel } from '../format/connections.ts'
import { takeWholeMinutes } from '../format/trains.ts'
import { log, redact } from '../log.ts'
import { messages as m } from '../messages.ts'
import { searchTransfers } from '../planner/csa.ts'
import { findDirect } from '../planner/direct.ts'
import { makeFilter } from '../planner/filters.ts'
import type { Journey } from '../planner/types.ts'
import { formatClock, formatDate, formatWarsawDateTime, warsawNow } from '../time.ts'
import type { Context } from './context.ts'
import { text, toolError } from './errors.ts'
import {
  carriersParam,
  categoriesParam,
  clockParam,
  dateParam,
  distinct,
  liveParam,
  parseDate,
  parseTime,
} from './inputs.ts'
import { liveDateOk, liveLabels } from './live.ts'

export function registerSearchConnections(server: McpServer, ctx: Context): void {
  server.registerTool(
    'search_connections',
    {
      title: 'Search train connections',
      description:
        'Find trains between two Polish stations or cities on a date, including changes. City names cover all their stations.',
      inputSchema: {
        from: z.string().min(1).describe('Origin station or city'),
        to: z.string().min(1).describe('Destination station or city'),
        date: dateParam,
        depart_after: clockParam('default now when date is today'),
        arrive_before: clockParam('optional'),
        max_transfers: z.number().int().min(0).max(2).optional().describe('Default 1; 0 = direct only'),
        min_transfer_min: z
          .number()
          .int()
          .min(0)
          .max(60)
          .optional()
          .describe('Minimum change time, default 5'),
        categories: categoriesParam,
        carriers: carriersParam,
        sort: z.enum(['departure', 'duration']).optional().describe('Default departure'),
        limit: z.number().int().min(1).max(10).optional().describe('Default 5'),
        live: liveParam,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        return text(await searchConnections(ctx, input))
      } catch (error) {
        return toolError(error)
      }
    },
  )
}

interface Input {
  from: string
  to: string
  date?: string | undefined
  depart_after?: string | undefined
  arrive_before?: string | undefined
  max_transfers?: number | undefined
  min_transfer_min?: number | undefined
  categories?: string[] | undefined
  carriers?: string[] | undefined
  sort?: 'departure' | 'duration' | undefined
  limit?: number | undefined
  live?: boolean | undefined
}

/** How results are picked from the candidates. */
type Selection = 'next' | 'latestBefore' | 'fastest'

async function searchConnections(ctx: Context, input: Input): Promise<string> {
  const today = warsawNow(ctx.now())
  const date = parseDate(input.date, today.date)
  let departAfter = parseTime('depart_after', input.depart_after)
  const arriveBefore = parseTime('arrive_before', input.arrive_before)
  // Today, trains that already left are never useful, even when only arrive_before is given.
  if (departAfter === undefined && date === today.date) departAfter = today.minutes
  const limit = input.limit ?? 5
  const maxTransfers = input.max_transfers ?? 1
  const selection: Selection =
    input.sort === 'duration'
      ? 'fastest'
      : arriveBefore !== undefined && input.depart_after === undefined
        ? 'latestBefore'
        : 'next'

  const [from, to] = await Promise.all([ctx.places.resolve(input.from), ctx.places.resolve(input.to)])
  const toIds = new Set(to.stationIds)
  if (from.stationIds.every((id) => toIds.has(id))) throw new UserError(m.samePlace(from.name))
  const filter = makeFilter(input.categories, input.carriers)
  const window = { departAfter, arriveBefore }
  const notes: string[] = []
  let staleSince = from.staleSince ?? to.staleSince

  // 1. Direct trains: one small request per pair and date. Skipped when the whole network is cached anyway.
  let direct:
    | { journeys: Journey[]; unfiltered: () => Journey[]; nameOf: (id: number) => string | undefined }
    | undefined
  if (maxTransfers === 0 || !(await ctx.timetables.networkReady(date))) {
    const timetable = await ctx.timetables.between(from.stationIds, to.stationIds, date)
    staleSince ??= timetable.staleSince
    const query = { fromIds: new Set(from.stationIds), toIds, date, ...window }
    direct = {
      journeys: findDirect(timetable.trips, { ...query, filter }),
      unfiltered: () => findDirect(timetable.trips, { ...query, filter: makeFilter() }),
      nameOf: (id) => timetable.stationNames.get(id),
    }
  }

  // 2. Changes: one large request per date, then free. Only fetched when direct trains do not suffice.
  let transfers: { journeys: Journey[]; more: boolean } | undefined
  if (maxTransfers > 0 && (!direct || direct.journeys.length < limit)) {
    try {
      const { network, staleSince: networkStale } = await ctx.timetables.network(date)
      staleSince ??= networkStale
      transfers = searchTransfers(network, {
        fromIds: from.stationIds,
        toIds: to.stationIds,
        departAfter: departAfter ?? 0,
        arriveBefore,
        maxTransfers,
        minTransferMin: input.min_transfer_min ?? 5,
        filter,
        limit,
        exhaustive: selection !== 'next',
      })
    } catch (error) {
      if (!direct) throw error
      log.warn('transfer search failed; showing direct trains only', error)
      notes.push(m.transfersUnavailable(redact(error instanceof Error ? error.message : String(error))))
    }
  }

  const nameOf = (id: number) => ctx.places.stationName(id) ?? direct?.nameOf(id) ?? `#${id}`
  const candidates = transfers?.journeys ?? direct?.journeys ?? []
  if (staleSince !== undefined) notes.push(m.staleNote(formatWarsawDateTime(staleSince)))

  if (candidates.length === 0) {
    const windowText = [
      departAfter === undefined ? '' : m.windowFrom(formatClock(departAfter)),
      arriveBefore === undefined ? '' : m.windowUntil(formatClock(arriveBefore)),
    ].join('')
    const fromLabel = placeLabel(from.name, from.isCity)
    const toLabel = placeLabel(to.name, to.isCity)
    const lines = [
      transfers
        ? m.noConnections(fromLabel, toLabel, formatDate(date), windowText, maxTransfers)
        : m.noDirect(fromLabel, toLabel, formatDate(date), windowText),
    ]
    if (direct && (filter.categories || filter.carriers)) {
      const unfiltered = direct.unfiltered()
      if (filter.categories)
        lines.push(
          m.knownCategories(
            distinct(unfiltered.flatMap((j) => j.legs.map((l) => l.from.category ?? l.trip.category))),
          ),
        )
      if (filter.carriers)
        lines.push(m.knownCarriers(distinct(unfiltered.flatMap((j) => j.legs.map((l) => l.trip.carrier)))))
    }
    return [...lines, ...notes].join('\n')
  }

  const { shown, hint } = select(candidates, selection, limit, transfers?.more)
  let delayOf: ((trip: Trip, stop: Stop) => string) | undefined
  if (input.live) {
    if (liveDateOk(date, today.date)) {
      const boarding = shown.flatMap((j) => j.legs.map((l) => l.from.stationId))
      const live = await liveLabels(ctx, boarding, 'dep')
      delayOf = live.delayOf
      if (live.note) notes.unshift(live.note)
    } else notes.unshift(m.liveOnlyRecent)
  }
  const body = formatConnections({
    fromLabel: from.name,
    toLabel: to.name,
    fromIsCity: from.isCity,
    toIsCity: to.isCity,
    date,
    shown,
    total: transfers ? undefined : candidates.length,
    withTransfers: transfers !== undefined,
    hint,
    nameOf,
    delayOf,
  })
  return [body, ...notes].join('\n')
}

/** `candidates` are sorted by departure. `more` tells whether a partial (non-exhaustive) list was cut. */
function select(
  candidates: Journey[],
  selection: Selection,
  limit: number,
  more: boolean | undefined,
): { shown: Journey[]; hint: string | undefined } {
  if (selection === 'fastest') {
    const fastest = [...candidates].sort((a, b) => a.arr - a.dep - (b.arr - b.dep) || a.dep - b.dep)
    return { shown: fastest.slice(0, limit), hint: undefined }
  }
  if (selection === 'latestBefore') {
    // Only an arrival deadline: the most useful journeys are the last ones that make it.
    const shown = candidates.slice(-limit)
    const first = shown[0]
    const hint =
      first && shown.length < candidates.length ? m.moreBefore(formatClock(first.arr - 1)) : undefined
    return { shown, hint }
  }
  const shown = more === undefined ? takeWholeMinutes(candidates, limit, (j) => j.dep) : candidates
  const last = shown[shown.length - 1]
  const cut = more ?? shown.length < candidates.length
  return { shown, hint: last && cut ? m.moreAfter('depart_after', formatClock(last.dep + 1)) : undefined }
}
