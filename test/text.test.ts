import { describe, expect, it } from 'vitest'
import { normalizeName } from '../src/text.ts'

describe('normalizeName', () => {
  it('strips Polish diacritics, including ł which NFD does not decompose', () => {
    expect(normalizeName('Łódź Kaliska')).toBe('lodz kaliska')
    expect(normalizeName('Kraków Płaszów')).toBe('krakow plaszow')
    expect(normalizeName('Żywiec ĄĘŚĆŃŹ')).toBe('zywiec aescnz')
  })

  it('turns punctuation into single spaces', () => {
    expect(normalizeName('  Bielsko-Biała   Gł. ')).toBe('bielsko biala gl')
  })
})
