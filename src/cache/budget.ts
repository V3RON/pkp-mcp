import type { QuotaTracker } from './quota.ts'

/** Basic tier, the default for new keys. Used when the API has not reported remaining quota. */
const ASSUMED_HOURLY_LIMIT = 100
const ASSUMED_DAILY_LIMIT = 1000
const RESERVE_SHARE = 0.1
const HOUR_MS = 60 * 60 * 1000

/**
 * Keeps optional requests (live delays, disruptions) from eating the quota that timetable
 * searches need: they are skipped once less than 10% of the hourly or daily budget is left.
 */
export class Budget {
  private readonly quota: QuotaTracker | undefined
  private readonly now: () => number

  constructor(quota: QuotaTracker | undefined, now: () => number = Date.now) {
    this.quota = quota
    this.now = now
  }

  allowsOptional(): boolean {
    if (!this.quota) return true
    const now = this.now()
    const s = this.quota.snapshot(now)
    // Remaining counts reported by the API win, but only while recent; otherwise count locally.
    const reported = s.observedAt !== undefined && now - s.observedAt < HOUR_MS
    const hourlyLeft = (reported ? s.hourlyRemaining : undefined) ?? ASSUMED_HOURLY_LIMIT - s.lastHour
    const dailyLeft = (reported ? s.dailyRemaining : undefined) ?? ASSUMED_DAILY_LIMIT - s.lastDay
    return (
      hourlyLeft > ASSUMED_HOURLY_LIMIT * RESERVE_SHARE && dailyLeft > ASSUMED_DAILY_LIMIT * RESERVE_SHARE
    )
  }
}
