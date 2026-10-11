import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { UserError } from '../errors.ts'
import { formatConnections, placeLabel } from '../format/connections.ts'
import { takeWholeMinutes } from '../format/trains.ts'
import { messages as m } from '../messages.ts'
import { findDirect } from '../planner/direct.ts'
import { makeFilter } from '../planner/filters.ts'
import { formatClock, formatDate, formatWarsawDateTime, warsawNow } from '../time.ts'
import type { Context } from './context.ts'
import { text, toolError } from './errors.ts'
import {
  carriersParam,
  categoriesParam,
  clockParam,
  dateParam,
  distinct,
  parseDate,
  parseTime,
} from './inputs.ts'

export function registerSearchConnections(server: McpServer, ctx: Context): void {
  server.registerTool(
    'search_connections',
    {
      title: 'Search train connections',
      description:
        'Find direct trains between two Polish stations or cities on a date. City names cover all their stations.',
      inputSchema: {
        from: z.string().min(1).describe('Origin station or city'),
        to: z.string().min(1).describe('Destination station or city'),
        date: dateParam,
        depart_after: clockParam('default now when date is today'),
        arrive_before: clockParam('optional'),
        categories: categoriesParam,
        carriers: carriersParam,
        sort: z.enum(['departure', 'duration']).optional().describe('Default departure'),
        limit: z.number().int().min(1).max(10).optional().describe('Default 5'),
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
  categories?: string[] | undefined
  carriers?: string[] | undefined
  sort?: 'departure' | 'duration' | undefined
  limit?: number | undefined
}

async function searchConnections(ctx: Context, input: Input): Promise<string> {
  const today = warsawNow(ctx.now())
  const date = parseDate(input.date, today.date)
  let departAfter = parseTime('depart_after', input.depart_after)
  const arriveBefore = parseTime('arrive_before', input.arrive_before)
  // Today, trains that already left are never useful, even when only arrive_before is given.
  if (departAfter === undefined && date === today.date) departAfter = today.minutes
  const limit = input.limit ?? 5

  const [from, to] = await Promise.all([ctx.places.resolve(input.from), ctx.places.resolve(input.to)])
  const toIds = new Set(to.stationIds)
  if (from.stationIds.every((id) => toIds.has(id))) throw new UserError(m.samePlace(from.name))

  const timetable = await ctx.timetables.between(from.stationIds, to.stationIds, date)
  const query = { fromIds: new Set(from.stationIds), toIds, date, departAfter, arriveBefore }
  const filter = makeFilter(input.categories, input.carriers)
  let journeys = findDirect(timetable.trips, { ...query, filter })
  const nameOf = (id: number) => ctx.places.stationName(id) ?? timetable.stationNames.get(id) ?? `#${id}`
  const staleSince = timetable.staleSince ?? from.staleSince ?? to.staleSince
  const staleLine = staleSince === undefined ? [] : [m.staleNote(formatWarsawDateTime(staleSince))]

  if (journeys.length === 0) {
    const window = [
      departAfter === undefined ? '' : m.windowFrom(formatClock(departAfter)),
      arriveBefore === undefined ? '' : m.windowUntil(formatClock(arriveBefore)),
    ].join('')
    const lines = [
      m.noDirect(
        placeLabel(from.name, from.isCity),
        placeLabel(to.name, to.isCity),
        formatDate(date),
        window,
      ),
    ]
    if (filter.categories || filter.carriers) {
      const unfiltered = findDirect(timetable.trips, { ...query, filter: makeFilter() })
      if (filter.categories)
        lines.push(m.knownCategories(distinct(unfiltered.map((j) => j.from.category ?? j.trip.category))))
      if (filter.carriers) lines.push(m.knownCarriers(distinct(unfiltered.map((j) => j.trip.carrier))))
    }
    return [...lines, ...staleLine].join('\n')
  }

  let shown: typeof journeys
  let hint: string | undefined
  if (input.sort === 'duration') {
    journeys = [...journeys].sort((a, b) => a.arr - a.dep - (b.arr - b.dep) || a.dep - b.dep)
    shown = journeys.slice(0, limit)
  } else if (arriveBefore !== undefined && input.depart_after === undefined) {
    // Only an arrival deadline: the most useful trains are the last ones that make it.
    shown = journeys.slice(-limit)
    const first = shown[0]
    if (first && shown.length < journeys.length) hint = m.moreBefore(formatClock(first.arr - 1))
  } else {
    shown = takeWholeMinutes(journeys, limit, (j) => j.dep)
    const last = shown[shown.length - 1]
    if (last && shown.length < journeys.length) hint = m.moreAfter('depart_after', formatClock(last.dep + 1))
  }

  const body = formatConnections({
    fromLabel: from.name,
    toLabel: to.name,
    fromIsCity: from.isCity,
    toIsCity: to.isCity,
    date,
    shown,
    total: journeys.length,
    hint,
    nameOf,
  })
  return [body, ...staleLine].join('\n')
}
