/**
 * Time handling. Timetable times are wall-clock Europe/Warsaw. Internally a time is "minutes since
 * 00:00 of a reference date" (it can be negative or exceed 1440 for neighbouring days).
 */
const WARSAW = 'Europe/Warsaw'
export const DAY_MIN = 1440
const DAY_MS = 24 * 60 * 60 * 1000

function warsawParts(epochMs: number): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: WARSAW,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(epochMs)
  return Object.fromEntries(parts.map((p) => [p.type, p.value]))
}

/** Current date (YYYY-MM-DD) and minutes since midnight in Poland. */
export function warsawNow(epochMs: number): { date: string; minutes: number } {
  const p = warsawParts(epochMs)
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) }
}

/** "2026-10-12 08:39" in Polish local time. */
export function formatWarsawDateTime(epochMs: number): string {
  const p = warsawParts(epochMs)
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
}

/** UTC midnight of a date, used for cache expiry (an hour or two off Warsaw time does not matter). */
export function dateEpochMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`)
}

/** "Mon 2026-10-12" */
export function formatDate(date: string): string {
  const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    timeZone: 'UTC',
  })
  return `${weekday} ${date}`
}

/** "08:05" → 485. Accepts H:MM and HH:MM. */
export function parseClock(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return undefined
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : undefined
}

/**
 * API "duration" times: .NET TimeSpan ("06:12:00", "1.02:30:00") or ISO 8601 ("PT6H12M").
 * Returns whole minutes.
 */
export function parseDuration(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const span = /^(-)?(?:(\d+)\.)?(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(value)
  if (span) {
    const total = Number(span[2] ?? 0) * DAY_MIN + Number(span[3]) * 60 + Number(span[4])
    return span[1] ? -total : total
  }
  const iso = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:[\d.]+S)?)?$/.exec(value)
  if (iso && value !== 'P' && value !== 'PT') {
    return Number(iso[1] ?? 0) * DAY_MIN + Number(iso[2] ?? 0) * 60 + Number(iso[3] ?? 0)
  }
  return undefined
}

/** 485 → "08:05"; next/previous days get a "+1"/"-1" suffix. */
export function formatClock(minutes: number): string {
  const dayOffset = Math.floor(minutes / DAY_MIN)
  const inDay = minutes - dayOffset * DAY_MIN
  const clock = `${String(Math.floor(inDay / 60)).padStart(2, '0')}:${String(inDay % 60).padStart(2, '0')}`
  if (dayOffset === 0) return clock
  return `${clock}${dayOffset > 0 ? '+' : ''}${dayOffset}`
}

/** 147 → "2h27", 45 → "45m". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`
}
