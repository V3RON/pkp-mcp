import type { Messages } from './en.ts'

export const pl: Messages = {
  city: 'miasto',
  station: 'stacja',
  stationsCount: (n: number) => `${n} ${plural(n, 'stacja', 'stacje', 'stacji')}`,
  noPlaceMatch: (query: string) => `Brak stacji ani miasta pasujących do „${query}”.`,
  placeMatches: (query: string, shown: number, total: number) =>
    total > shown ? `Wyniki dla „${query}” (${shown} z ${total}):` : `Wyniki dla „${query}”:`,
  missingKey: (signupUrl: string) =>
    `Brak PKP_API_KEY. Bezpłatny klucz można uzyskać na ${signupUrl} i dodać do env serwera MCP.`,
  invalidKey: (signupUrl: string) =>
    `API PKP odrzuciło klucz (401). Sprawdź PKP_API_KEY lub poproś o nowy na ${signupUrl}.`,
  rateLimited: (retryAfterMin: number | undefined) =>
    retryAfterMin === undefined
      ? 'Wyczerpano limit zapytań do API PKP. Spróbuj później.'
      : `Wyczerpano limit zapytań do API PKP. Spróbuj ponownie za ok. ${retryAfterMin} min.`,
  apiUnavailable: 'API PKP jest teraz niedostępne, a dla tego zapytania nie ma danych w pamięci podręcznej.',
  staleNote: (at: string) => `(dane z pamięci podręcznej z ${at}; API PKP jest niedostępne)`,
}

/** Polish plural forms: 1 stacja, 2–4 stacje (except 12–14), 5+ stacji. */
function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one
  const lastTwo = n % 100
  const last = n % 10
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return few
  return many
}
