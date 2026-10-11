import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { ApiError } from '../api/client.ts'
import { SIGNUP_URL } from '../config.ts'
import { UserError } from '../errors.ts'
import { log, redact } from '../log.ts'
import { messages as m } from '../messages.ts'

export function text(body: string): CallToolResult {
  return { content: [{ type: 'text', text: body }] }
}

/** Turns any failure into a one-line tool error the model can act on. */
export function toolError(error: unknown): CallToolResult {
  const body = errorText(error)
  const expected =
    error instanceof UserError ||
    (error instanceof ApiError && error.kind !== 'http' && error.kind !== 'network')
  if (!expected) {
    log.error('tool failed', error)
  }
  return { content: [{ type: 'text', text: body }], isError: true }
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.kind) {
      case 'missing_key':
        return m.missingKey(SIGNUP_URL)
      case 'unauthorized':
        return m.invalidKey(SIGNUP_URL)
      case 'rate_limited':
        return m.rateLimited(
          error.retryAfterSec === undefined ? undefined : Math.ceil(error.retryAfterSec / 60),
        )
      case 'network':
        return m.apiUnavailable
      default:
        return redact(error.message)
    }
  }
  return redact(error instanceof Error ? error.message : String(error))
}
