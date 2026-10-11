/** User-facing strings for tool results. */
export const messages = {
  city: 'city',
  stationsCount: (n: number) => (n === 1 ? '1 station' : `${n} stations`),
  noPlaceMatch: (query: string) => `No station or city matches "${query}".`,
  placeMatches: (query: string, shown: number, total: number) =>
    total > shown ? `Matches for "${query}" (${shown} of ${total}):` : `Matches for "${query}":`,
  ambiguousPlace: (query: string, candidates: string[]) =>
    `"${query}" is ambiguous: ${candidates.join(', ')}. Use a more specific name or a station ID.`,
  badDate: (value: string) => `Invalid date "${value}". Use YYYY-MM-DD.`,
  badTime: (name: string, value: string) => `Invalid ${name} "${value}". Use HH:MM (24-hour).`,
  samePlace: (name: string) => `Origin and destination are the same place (${name}).`,
  noDirect: (from: string, to: string, date: string, window: string) =>
    `No direct trains ${from} → ${to} on ${date}${window}.`,
  noBoard: (station: string, type: string, date: string, window: string) =>
    `No ${type} at ${station} on ${date}${window}.`,
  windowFrom: (time: string) => ` after ${time}`,
  windowUntil: (time: string) => ` until ${time}`,
  knownCategories: (values: string[]) => `Categories here: ${values.join(', ')}.`,
  knownCarriers: (values: string[]) => `Carriers here: ${values.join(', ')}.`,
  moreAfter: (param: string, time: string) => `More: ${param}=${time}`,
  moreBefore: (time: string) => `Earlier: arrive_before=${time}`,
  missingKey: (signupUrl: string) =>
    `PKP_API_KEY is not set. Request a free key at ${signupUrl} and add it to the MCP server's env.`,
  invalidKey: (signupUrl: string) =>
    `The PKP API rejected the key (401). Check PKP_API_KEY or request one at ${signupUrl}.`,
  rateLimited: (retryAfterMin: number | undefined) =>
    retryAfterMin === undefined
      ? 'PKP API request limit reached. Try again later.'
      : `PKP API request limit reached. Try again in about ${retryAfterMin} min.`,
  apiUnavailable: 'The PKP API is unavailable right now, and there is no cached data for this request.',
  staleNote: (at: string) => `(cached data from ${at}; the PKP API is unavailable)`,
}
