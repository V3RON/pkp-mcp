import { log } from '../log.ts'

export type ApiErrorKind = 'missing_key' | 'unauthorized' | 'rate_limited' | 'not_found' | 'http' | 'network'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | undefined
  readonly retryAfterSec: number | undefined

  constructor(kind: ApiErrorKind, message: string, status?: number, retryAfterSec?: number) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
    this.retryAfterSec = retryAfterSec
  }
}

export type Query = Record<string, string | number | boolean | undefined>

export interface ClientOptions {
  baseUrl: string
  apiKey: string | undefined
  fetch?: typeof fetch
  /** Called once per HTTP request actually sent (not for deduplicated or cached calls). */
  onRequest?: (at: number, headers: Headers | undefined) => void
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  timeoutMs?: number
}

/** Waiting longer than this inside a tool call risks hitting the MCP client's tool timeout. */
const MAX_RETRY_AFTER_WAIT_SEC = 20
const MAX_429_RETRIES = 2
const DEFAULT_TIMEOUT_MS = 8000

export class PdpClient {
  private readonly options: Required<Omit<ClientOptions, 'apiKey' | 'onRequest'>> &
    Pick<ClientOptions, 'apiKey' | 'onRequest'>
  private readonly inflight = new Map<string, Promise<unknown>>()

  constructor(options: ClientOptions) {
    this.options = {
      fetch: globalThis.fetch.bind(globalThis),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: Date.now,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      ...options,
    }
  }

  get hasKey(): boolean {
    return this.options.apiKey !== undefined
  }

  /** GET a JSON endpoint. Concurrent identical calls share one HTTP request. */
  getJson(path: string, query: Query = {}, opts: { timeoutMs?: number } = {}): Promise<unknown> {
    const url = this.buildUrl(path, query)
    const pending = this.inflight.get(url)
    if (pending) return pending
    const request = this.fetchWithRetry(url, path, opts.timeoutMs ?? this.options.timeoutMs).finally(() =>
      this.inflight.delete(url),
    )
    this.inflight.set(url, request)
    return request
  }

  private buildUrl(path: string, query: Query): string {
    const url = new URL(path, `${this.options.baseUrl}/`)
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(name, String(value))
    }
    return url.toString()
  }

  private async fetchWithRetry(url: string, path: string, timeoutMs: number): Promise<unknown> {
    const apiKey = this.options.apiKey
    if (apiKey === undefined) throw new ApiError('missing_key', 'PKP_API_KEY is not set')

    let rateLimitRetries = 0
    let serverErrorRetried = false
    for (;;) {
      let response: Response
      try {
        response = await this.options.fetch(url, {
          headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (error) {
        this.options.onRequest?.(this.options.now(), undefined)
        if (!serverErrorRetried) {
          serverErrorRetried = true
          log.debug('network error, retrying once', { path, error })
          await this.options.sleep(jitter())
          continue
        }
        throw new ApiError('network', `Request to ${path} failed: ${describe(error)}`)
      }
      this.options.onRequest?.(this.options.now(), response.headers)
      log.debug('GET', { path, status: response.status })

      if (response.ok) return response.json()

      if (response.status === 429) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'), this.options.now())
        if (
          retryAfter !== undefined &&
          retryAfter <= MAX_RETRY_AFTER_WAIT_SEC &&
          rateLimitRetries < MAX_429_RETRIES
        ) {
          rateLimitRetries++
          await this.options.sleep(retryAfter * 1000)
          continue
        }
        throw new ApiError('rate_limited', `Rate limited on ${path}`, 429, retryAfter)
      }
      if (response.status >= 500 && !serverErrorRetried) {
        serverErrorRetried = true
        await this.options.sleep(jitter())
        continue
      }
      const detail = await errorDetail(response)
      if (response.status === 401 || response.status === 403) {
        throw new ApiError(
          'unauthorized',
          `Unauthorized (${response.status}) on ${path}${detail}`,
          response.status,
        )
      }
      if (response.status === 404) throw new ApiError('not_found', `Not found: ${path}${detail}`, 404)
      throw new ApiError('http', `HTTP ${response.status} on ${path}${detail}`, response.status)
    }
  }
}

/** Seconds to wait, from either delta-seconds or an HTTP date. */
export function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds))
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - now) / 1000))
}

/** Only the API's own `message` field is kept; bodies and request headers never reach errors or logs. */
async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown }
    return typeof body.message === 'string' ? `: ${body.message.slice(0, 200)}` : ''
  } catch {
    return ''
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.name === 'TimeoutError' ? 'timed out' : error.message
  return String(error)
}

function jitter(): number {
  return 500 + Math.floor(Math.random() * 1000)
}
