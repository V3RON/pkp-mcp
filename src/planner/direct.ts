import { offsetTo, type Stop, type Trip } from '../data/trips.ts'
import { DAY_MIN } from '../time.ts'
import { passes, type TrainFilter } from './filters.ts'
import { type Journey, journeyOf } from './types.ts'

export interface DirectQuery {
  fromIds: Set<number>
  toIds: Set<number>
  date: string
  departAfter: number | undefined
  arriveBefore: number | undefined
  filter: TrainFilter
}

/**
 * Direct trains departing on `date`, sorted by departure. When a train calls at several stations of
 * the origin (a city), it is boarded at the last of them and left at the first station of the
 * destination: the shortest ride between the two places, with the station named in the output.
 */
export function findDirect(trips: Trip[], q: DirectQuery): Journey[] {
  const journeys: Journey[] = []
  for (const trip of trips) {
    const leg = boardingLeg(trip.stops, q.fromIds, q.toIds)
    if (!leg) continue
    const { from, to } = leg
    const offset = offsetTo(trip, q.date)
    const dep = offset + (from.dep as number)
    const arr = offset + (to.arr as number)
    if (dep < 0 || dep >= DAY_MIN) continue
    if (q.departAfter !== undefined && dep < q.departAfter) continue
    if (q.arriveBefore !== undefined && arr > q.arriveBefore) continue
    if (!passes(q.filter, trip, from)) continue
    journeys.push(journeyOf([{ trip, from, to, dep, arr }]))
  }
  return journeys.sort((a, b) => a.dep - b.dep || a.arr - b.arr)
}

function boardingLeg(
  stops: Stop[],
  fromIds: Set<number>,
  toIds: Set<number>,
): { from: Stop; to: Stop } | undefined {
  let from: Stop | undefined
  for (const stop of stops) {
    if (!stop.passenger) continue
    if (from && toIds.has(stop.stationId) && stop.arr !== undefined) return { from, to: stop }
    if (fromIds.has(stop.stationId) && stop.dep !== undefined) from = stop
  }
  return undefined
}
