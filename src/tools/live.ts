import { type LiveGap, liveKey } from '../data/live.ts'
import type { Stop, Trip } from '../data/trips.ts'
import { delayLabel, type Side } from '../format/live.ts'
import { messages as m } from '../messages.ts'
import { addDays } from '../time.ts'
import type { Context } from './context.ts'

/** Live data only exists for trains running today or (overnight) since yesterday. */
export function liveDateOk(date: string, today: string): boolean {
  return date === today || date === addDays(today, -1)
}

export function gapNote(gap: LiveGap): string {
  return gap === 'budget' ? m.liveSkippedBudget : gap === 'not-tracked' ? m.liveNotTracked : m.liveUnavailable
}

/**
 * Live delays for a set of boarding stations (one request, cached 1 min). Returns a label function
 * for the formatters, or a note explaining why there is none.
 */
export async function liveLabels(
  ctx: Context,
  stationIds: number[],
  side: Side,
): Promise<{ delayOf: ((trip: Trip, stop: Stop) => string) | undefined; note: string | undefined }> {
  if (stationIds.length === 0) return { delayOf: undefined, note: undefined }
  const result = await ctx.live.atStations(stationIds)
  if (!result.ok) return { delayOf: undefined, note: gapNote(result.gap) }
  const trains = result.value
  return { delayOf: (trip, stop) => delayLabel(trains.get(liveKey(trip)), stop, side), note: undefined }
}
