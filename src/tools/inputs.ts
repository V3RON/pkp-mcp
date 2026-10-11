import { z } from 'zod'
import { UserError } from '../errors.ts'
import { messages as m } from '../messages.ts'
import { isIsoDate, parseClock } from '../time.ts'

/** Shared parameter schemas: flat, short descriptions (they are sent with every request). */
export const dateParam = z.string().optional().describe('YYYY-MM-DD, default today (Polish time)')
export const clockParam = (what: string) => z.string().optional().describe(`HH:MM, ${what}`)
export const categoriesParam = z
  .array(z.string())
  .optional()
  .describe('Train categories, e.g. ["EIP","EIC","IC","TLK"] or regional ["R","KM","KS"]')
export const carriersParam = z.array(z.string()).optional().describe('Carrier codes, e.g. ["IC","PR","KM"]')

export function parseDate(value: string | undefined, today: string): string {
  if (value === undefined || value.trim() === '') return today
  const date = value.trim()
  if (!isIsoDate(date)) throw new UserError(m.badDate(value))
  return date
}

export function parseTime(name: string, value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const minutes = parseClock(value)
  if (minutes === undefined) throw new UserError(m.badTime(name, value))
  return minutes
}

/** Distinct sorted values, for "did you mean" hints after an over-strict filter. */
export function distinct(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort()
}
