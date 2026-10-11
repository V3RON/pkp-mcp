/** Letters that NFD decomposition does not split into base + combining mark. */
const SPECIAL: Record<string, string> = { ł: 'l', Ł: 'l', ß: 'ss', æ: 'ae', ø: 'o', đ: 'd' }

/**
 * Search key for place names: lowercase, no diacritics, punctuation collapsed to single spaces.
 * "Kraków Płaszów" → "krakow plaszow", "Bielsko-Biała" → "bielsko biala".
 */
export function normalizeName(text: string): string {
  return text
    .replace(/[łŁßæøđ]/g, (ch) => SPECIAL[ch] ?? ch)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}
