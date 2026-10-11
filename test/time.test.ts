import { describe, expect, it } from 'vitest'
import {
  addDays,
  formatClock,
  formatDate,
  formatDuration,
  parseClock,
  parseDuration,
  warsawNow,
} from '../src/time.ts'

describe('time', () => {
  it('parses API durations in .NET and ISO 8601 forms', () => {
    expect(parseDuration('06:12:00')).toBe(372)
    expect(parseDuration('1.02:30:00')).toBe(1590)
    expect(parseDuration('PT6H12M')).toBe(372)
    expect(parseDuration('PT45M')).toBe(45)
    expect(parseDuration('P1DT0H5M')).toBe(1445)
    expect(parseDuration('')).toBeUndefined()
    expect(parseDuration('later')).toBeUndefined()
  })

  it('formats clock times with a day suffix outside the reference day', () => {
    expect(formatClock(485)).toBe('08:05')
    expect(formatClock(1440 + 70)).toBe('01:10+1')
    expect(formatClock(-30)).toBe('23:30-1')
  })

  it('formats durations and dates', () => {
    expect(formatDuration(45)).toBe('45m')
    expect(formatDuration(147)).toBe('2h27')
    expect(formatDate('2026-10-12')).toBe('Mon 2026-10-12')
  })

  it('validates HH:MM input', () => {
    expect(parseClock('8:05')).toBe(485)
    expect(parseClock('24:00')).toBeUndefined()
    expect(parseClock('8.05')).toBeUndefined()
  })

  it('does calendar arithmetic across month ends', () => {
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31')
  })

  it('uses Polish time regardless of the machine time zone', () => {
    // 22:30 UTC on 11 Oct is 00:30 on 12 Oct in Warsaw (CEST, UTC+2).
    expect(warsawNow(Date.parse('2026-10-11T22:30:00Z'))).toEqual({ date: '2026-10-12', minutes: 30 })
  })
})
