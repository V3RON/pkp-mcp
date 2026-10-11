import type { PlaceSearch } from '../data/places.ts'
import type { Messages } from '../i18n/index.ts'
import { formatWarsawDateTime } from './time.ts'

/**
 * One line per match, e.g.
 *   Kraków — city, 14 stations
 *   12345 Kraków Główny
 */
export function formatPlaceSearch(query: string, result: PlaceSearch, msgs: Messages): string {
  if (result.matches.length === 0) return msgs.noPlaceMatch(query)
  const lines = [msgs.placeMatches(query, result.matches.length, result.total)]
  for (const place of result.matches) {
    lines.push(
      place.kind === 'city'
        ? `${place.name} — ${msgs.city}, ${msgs.stationsCount(place.stationIds.length)}`
        : `${place.id} ${place.name}`,
    )
  }
  if (result.staleSince !== undefined) lines.push(msgs.staleNote(formatWarsawDateTime(result.staleSince)))
  return lines.join('\n')
}
