import { describe, expect, it } from 'vitest'
import { Budget } from '../src/cache/budget.ts'
import { openMemoryDb } from '../src/cache/db.ts'
import { QuotaTracker } from '../src/cache/quota.ts'
import { minutesOf } from '../src/data/live.ts'

describe('minutesOf', () => {
  it('reads zone-less API times as Polish local time relative to a date', () => {
    expect(minutesOf('2026-10-12T08:39:00', '2026-10-12')).toBe(519)
    expect(minutesOf('2026-10-13T00:30:00', '2026-10-12')).toBe(1470)
    expect(minutesOf(null, '2026-10-12')).toBeUndefined()
  })

  it('converts times with an explicit zone to Polish time', () => {
    // 06:39 UTC = 08:39 CEST
    expect(minutesOf('2026-10-12T06:39:00Z', '2026-10-12')).toBe(519)
    expect(minutesOf('2026-10-12T06:39:00+00:00', '2026-10-12')).toBe(519)
  })
})

describe('Budget', () => {
  const now = Date.parse('2026-10-11T12:00:00Z')

  it('allows optional requests while plenty of quota is left', () => {
    const quota = new QuotaTracker(openMemoryDb(), 'k')
    for (let i = 0; i < 50; i++) quota.record(now - 1000)
    expect(new Budget(quota, () => now).allowsOptional()).toBe(true)
  })

  it('stops optional requests near the hourly limit (Basic tier assumed)', () => {
    const quota = new QuotaTracker(openMemoryDb(), 'k')
    for (let i = 0; i < 91; i++) quota.record(now - 1000)
    expect(new Budget(quota, () => now).allowsOptional()).toBe(false)
  })

  it('trusts recent remaining-quota headers over the local count', () => {
    const quota = new QuotaTracker(openMemoryDb(), 'k')
    quota.record(
      now - 1000,
      new Headers({ 'X-RateLimit-Hourly-Remaining': '5', 'X-RateLimit-Daily-Remaining': '900' }),
    )
    expect(new Budget(quota, () => now).allowsOptional()).toBe(false)
    // Two hours later the reading is stale; the local count (1 request) applies again.
    expect(new Budget(quota, () => now + 2 * 60 * 60 * 1000).allowsOptional()).toBe(true)
  })
})
