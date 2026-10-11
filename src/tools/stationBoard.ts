import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { Stop, Trip } from '../data/trips.ts'
import { formatBoard } from '../format/board.ts'
import { placeLabel } from '../format/connections.ts'
import { takeWholeMinutes } from '../format/trains.ts'
import { messages as m } from '../messages.ts'
import { buildBoard } from '../planner/board.ts'
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
  liveParam,
  parseDate,
  parseTime,
} from './inputs.ts'
import { liveDateOk, liveLabels } from './live.ts'

export function registerStationBoard(server: McpServer, ctx: Context): void {
  server.registerTool(
    'station_board',
    {
      title: 'Station departures/arrivals',
      description: 'Departure or arrival board for a Polish station or city on a date.',
      inputSchema: {
        station: z.string().min(1).describe('Station or city'),
        type: z.enum(['departures', 'arrivals']).optional().describe('Default departures'),
        date: dateParam,
        from_time: clockParam('default now when date is today'),
        to_time: clockParam('optional'),
        categories: categoriesParam,
        carriers: carriersParam,
        limit: z.number().int().min(1).max(30).optional().describe('Default 10'),
        live: liveParam,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        return text(await stationBoard(ctx, input))
      } catch (error) {
        return toolError(error)
      }
    },
  )
}

interface Input {
  station: string
  type?: 'departures' | 'arrivals' | undefined
  date?: string | undefined
  from_time?: string | undefined
  to_time?: string | undefined
  categories?: string[] | undefined
  carriers?: string[] | undefined
  limit?: number | undefined
  live?: boolean | undefined
}

async function stationBoard(ctx: Context, input: Input): Promise<string> {
  const today = warsawNow(ctx.now())
  const date = parseDate(input.date, today.date)
  const type = input.type ?? 'departures'
  const fromTime = parseTime('from_time', input.from_time) ?? (date === today.date ? today.minutes : 0)
  const toTime = parseTime('to_time', input.to_time)
  const limit = input.limit ?? 10

  const place = await ctx.places.resolve(input.station)
  const timetable = await ctx.timetables.at(place.stationIds, date)
  const query = { stationIds: new Set(place.stationIds), date, type, fromTime, toTime }
  const filter = makeFilter(input.categories, input.carriers)
  const entries = buildBoard(timetable.trips, { ...query, filter })
  const nameOf = (id: number) => ctx.places.stationName(id) ?? timetable.stationNames.get(id) ?? `#${id}`
  const staleSince = timetable.staleSince ?? place.staleSince
  const staleLine = staleSince === undefined ? [] : [m.staleNote(formatWarsawDateTime(staleSince))]

  if (entries.length === 0) {
    const window =
      m.windowFrom(formatClock(fromTime)) + (toTime === undefined ? '' : m.windowUntil(formatClock(toTime)))
    const lines = [m.noBoard(placeLabel(place.name, place.isCity), type, formatDate(date), window)]
    if (filter.categories || filter.carriers) {
      const unfiltered = buildBoard(timetable.trips, { ...query, filter: makeFilter() })
      if (filter.categories)
        lines.push(m.knownCategories(distinct(unfiltered.map((e) => e.stop.category ?? e.trip.category))))
      if (filter.carriers) lines.push(m.knownCarriers(distinct(unfiltered.map((e) => e.trip.carrier))))
    }
    return [...lines, ...staleLine].join('\n')
  }

  const shown = takeWholeMinutes(entries, limit, (e) => e.time)
  const last = shown[shown.length - 1]
  const hint =
    last && shown.length < entries.length ? m.moreAfter('from_time', formatClock(last.time + 1)) : undefined
  let delayOf: ((trip: Trip, stop: Stop) => string) | undefined
  const notes: string[] = []
  if (input.live) {
    if (liveDateOk(date, today.date)) {
      const live = await liveLabels(ctx, place.stationIds, type === 'departures' ? 'dep' : 'arr')
      delayOf = live.delayOf
      if (live.note) notes.push(live.note)
    } else notes.push(m.liveOnlyRecent)
  }
  const body = formatBoard({
    stationLabel: place.name,
    isCity: place.isCity,
    type,
    date,
    shown,
    total: entries.length,
    hint,
    nameOf,
    delayOf,
  })
  return [body, ...notes, ...staleLine].join('\n')
}
