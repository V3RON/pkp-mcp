export const en = {
  city: 'city',
  station: 'station',
  stationsCount: (n: number) => (n === 1 ? '1 station' : `${n} stations`),
  noPlaceMatch: (query: string) => `No station or city matches "${query}".`,
  placeMatches: (query: string, shown: number, total: number) =>
    total > shown ? `Matches for "${query}" (${shown} of ${total}):` : `Matches for "${query}":`,
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

export type Messages = typeof en
