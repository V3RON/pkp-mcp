import type { PlaceSearch } from '../data/places.ts'
import { messages as m } from '../messages.ts'
import { formatWarsawDateTime } from '../time.ts'

/**
 * One line per match, e.g.
 *   Kraków — city, 14 stations
 *   12345 Kraków Główny
 */
export function formatPlaceSearch(query: string, result: PlaceSearch): string {
  if (result.matches.length === 0) return m.noPlaceMatch(query)
  const lines = [m.placeMatches(query, result.matches.length, result.total)]
  for (const place of result.matches) {
    lines.push(
      place.kind === 'city'
        ? `${place.name} — ${m.city}, ${m.stationsCount(place.stationIds.length)}`
        : `${place.id} ${place.name}`,
    )
  }
  if (result.staleSince !== undefined) lines.push(m.staleNote(formatWarsawDateTime(result.staleSince)))
  return lines.join('\n')
}
