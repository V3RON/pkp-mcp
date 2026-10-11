import { offsetTo, type Trip } from '../data/trips.ts'
import { DAY_MIN } from '../time.ts'

/** Journeys may run into the next morning, so connections are kept up to this many minutes after midnight. */
const NEXT_DAY_HORIZON_MIN = 12 * 60

/**
 * Every train hop (passenger stop → next passenger stop) for one search date, sorted by departure,
 * in flat typed arrays so the connection scan stays fast over ~100k hops.
 */
export interface Network {
  date: string
  trips: Trip[]
  /** Station ID → dense index used by the arrays below. */
  stationIndex: Map<number, number>
  stationIds: number[]
  dep: Int32Array
  arr: Int32Array
  from: Int32Array
  to: Int32Array
  trip: Int32Array
  /** Index into trip.stops of the hop's departure and arrival stop. */
  fromStop: Int32Array
  toStop: Int32Array
}

/** `trips` should cover the search date and the day before (overnight trains). */
export function buildNetwork(trips: Trip[], date: string): Network {
  const stationIndex = new Map<number, number>()
  const stationIds: number[] = []
  const indexOf = (id: number) => {
    let index = stationIndex.get(id)
    if (index === undefined) {
      index = stationIds.length
      stationIndex.set(id, index)
      stationIds.push(id)
    }
    return index
  }

  const hops: [
    dep: number,
    arr: number,
    from: number,
    to: number,
    trip: number,
    fromStop: number,
    toStop: number,
  ][] = []
  trips.forEach((trip, tripIndex) => {
    const offset = offsetTo(trip, date)
    let prev = -1
    trip.stops.forEach((stop, stopIndex) => {
      if (!stop.passenger) return
      const before = trip.stops[prev]
      if (before?.dep !== undefined && stop.arr !== undefined) {
        const dep = offset + before.dep
        const arr = offset + stop.arr
        if (dep >= 0 && dep < DAY_MIN + NEXT_DAY_HORIZON_MIN && arr >= dep) {
          hops.push([
            dep,
            arr,
            indexOf(before.stationId),
            indexOf(stop.stationId),
            tripIndex,
            prev,
            stopIndex,
          ])
        }
      }
      prev = stopIndex
    })
  })
  hops.sort((a, b) => a[0] - b[0] || a[1] - b[1])

  const column = (i: number) => Int32Array.from(hops, (h) => h[i] as number)
  return {
    date,
    trips,
    stationIndex,
    stationIds,
    dep: column(0),
    arr: column(1),
    from: column(2),
    to: column(3),
    trip: column(4),
    fromStop: column(5),
    toStop: column(6),
  }
}
