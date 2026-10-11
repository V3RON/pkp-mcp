import type { Stop, Trip } from '../data/trips.ts'

export interface TrainFilter {
  categories: Set<string> | undefined
  carriers: Set<string> | undefined
}

export function makeFilter(categories?: string[], carriers?: string[]): TrainFilter {
  const set = (values?: string[]) =>
    values?.length ? new Set(values.map((v) => v.trim().toUpperCase()).filter(Boolean)) : undefined
  return { categories: set(categories), carriers: set(carriers) }
}

/** Category is checked at the boarding stop, since it can change along the route. */
export function passes(filter: TrainFilter, trip: Trip, stop: Stop): boolean {
  if (filter.carriers && !filter.carriers.has((trip.carrier ?? '').toUpperCase())) return false
  if (filter.categories && !filter.categories.has((stop.category ?? trip.category ?? '').toUpperCase()))
    return false
  return true
}
