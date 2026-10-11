import type { Stop, Trip } from '../data/trips.ts'

/** One train ride. Times are minutes since 00:00 of the search date. */
export interface Leg {
  trip: Trip
  from: Stop
  to: Stop
  dep: number
  arr: number
}

/** One or more legs; consecutive legs change trains at the same station. */
export interface Journey {
  legs: Leg[]
  dep: number
  arr: number
}

export function journeyOf(legs: Leg[]): Journey {
  const first = legs[0]
  const last = legs[legs.length - 1]
  if (!first || !last) throw new Error('journey without legs')
  return { legs, dep: first.dep, arr: last.arr }
}
