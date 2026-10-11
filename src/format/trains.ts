import type { Stop, Trip } from '../data/trips.ts'

/** `EIP 3510 "Mehoffer" (IC)`: category and number as shown at the given stop. */
export function trainLabel(trip: Trip, stop: Stop): string {
  const category = stop.category ?? trip.category
  const number = stop.number ?? trip.number
  const parts = [category, number].filter(Boolean).join(' ') || '?'
  const name = trip.name ? ` "${trip.name}"` : ''
  const carrier = trip.carrier ? ` (${trip.carrier})` : ''
  return `${parts}${name}${carrier}`
}

/** `pl.3 tr.5`, or '' when the timetable has neither. */
export function platformLabel(platform: string | undefined, track: string | undefined): string {
  return [platform && `pl.${platform}`, track && `tr.${track}`].filter(Boolean).join(' ')
}

/** Station name lookup that never fails: catalogue, then response dictionary, then the ID. */
export type NameOf = (stationId: number) => string

/**
 * Cuts a sorted list after `limit` items, but keeps any further items sharing the last item's
 * minute, so a "next page from minute+1" hint never skips a train.
 */
export function takeWholeMinutes<T>(items: T[], limit: number, minuteOf: (item: T) => number): T[] {
  if (items.length <= limit) return items
  const last = minuteOf(items[limit - 1] as T)
  let end = limit
  while (end < items.length && minuteOf(items[end] as T) === last) end++
  return items.slice(0, end)
}
