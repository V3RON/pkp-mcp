import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { ApiError } from '../api/client.ts'
import { SIGNUP_URL } from '../config.ts'
import type { Messages } from '../i18n/index.ts'
import { log, redact } from '../log.ts'

export function text(body: string): CallToolResult {
  return { content: [{ type: 'text', text: body }] }
}

/** Turns any failure into a one-line, localized tool error the model can act on. */
export function toolError(error: unknown, msgs: Messages): CallToolResult {
  const body = errorText(error, msgs)
  if (!(error instanceof ApiError) || error.kind === 'http' || error.kind === 'network') {
    log.error('tool failed', error)
  }
  return { content: [{ type: 'text', text: body }], isError: true }
}

function errorText(error: unknown, msgs: Messages): string {
  if (error instanceof ApiError) {
    switch (error.kind) {
      case 'missing_key':
        return msgs.missingKey(SIGNUP_URL)
      case 'unauthorized':
        return msgs.invalidKey(SIGNUP_URL)
      case 'rate_limited':
        return msgs.rateLimited(
          error.retryAfterSec === undefined ? undefined : Math.ceil(error.retryAfterSec / 60),
        )
      case 'network':
        return msgs.apiUnavailable
      default:
        return redact(error.message)
    }
  }
  return redact(error instanceof Error ? error.message : String(error))
}
