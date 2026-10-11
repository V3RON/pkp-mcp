import { offsetTo, type Stop, type Trip } from '../data/trips.ts'
import { DAY_MIN } from '../time.ts'
import { passes, type TrainFilter } from './filters.ts'

export type BoardType = 'departures' | 'arrivals'

export interface BoardEntry {
  trip: Trip
  stop: Stop
  /** Minutes since 00:00 of the board date. */
  time: number
  /** Destination (departures) or origin (arrivals); undefined when the API returned a trimmed route. */
  endpointId: number | undefined
}

export interface BoardQuery {
  stationIds: Set<number>
  date: string
  type: BoardType
  fromTime: number
  toTime: number | undefined
  filter: TrainFilter
}

/** Departures or arrivals at a set of stations within a time window, sorted by time. */
export function buildBoard(trips: Trip[], q: BoardQuery): BoardEntry[] {
  const entries: BoardEntry[] = []
  for (const trip of trips) {
    const offset = offsetTo(trip, q.date)
    const passengerStops = trip.stops.filter((s) => s.passenger)
    const first = passengerStops[0]
    const last = passengerStops[passengerStops.length - 1]
    for (const stop of passengerStops) {
      if (!q.stationIds.has(stop.stationId)) continue
      const local = q.type === 'departures' ? stop.dep : stop.arr
      if (local === undefined) continue
      const time = offset + local
      if (time < q.fromTime || time >= DAY_MIN || (q.toTime !== undefined && time > q.toTime)) continue
      if (!passes(q.filter, trip, stop)) continue
      const endpoint = q.type === 'departures' ? last : first
      entries.push({
        trip,
        stop,
        time,
        endpointId: endpoint && endpoint !== stop ? endpoint.stationId : undefined,
      })
    }
  }
  return entries.sort((a, b) => a.time - b.time)
}
