import { describe, expect, it, vi } from 'vitest'
import { ApiError, PdpClient, parseRetryAfter } from '../src/api/client.ts'
import { fakeFetch, json, noSleep } from './helpers.ts'

const KEY = 'secret-key-abc123'

function client(
  routes: Parameters<typeof fakeFetch>[0],
  extra: { onRequest?: () => void; sleep?: () => Promise<void> } = {},
) {
  const fake = fakeFetch(routes)
  const c = new PdpClient({
    baseUrl: 'https://api.test',
    apiKey: KEY,
    fetch: fake.fetch,
    sleep: noSleep,
    ...extra,
  })
  return { c, calls: fake.calls }
}

describe('PdpClient', () => {
  it('sends the key in X-API-Key and never in the URL', async () => {
    const { c, calls } = client({ '/api/v1/data-version': () => json({ dataVersion: 'x' }) })
    await c.getJson('api/v1/data-version', { a: 1, skip: undefined })
    expect(calls[0]?.headers.get('x-api-key')).toBe(KEY)
    expect(calls[0]?.url.toString()).toBe('https://api.test/api/v1/data-version?a=1')
  })

  it('fails fast without a key and sends nothing', async () => {
    const fake = fakeFetch({})
    const c = new PdpClient({ baseUrl: 'https://api.test', apiKey: undefined, fetch: fake.fetch })
    await expect(c.getJson('api/v1/data-version')).rejects.toMatchObject({ kind: 'missing_key' })
    expect(fake.calls).toHaveLength(0)
  })

  it('shares one HTTP request between concurrent identical calls', async () => {
    const onRequest = vi.fn()
    const { c, calls } = client({ '/x': () => json({ ok: true }) }, { onRequest })
    const [a, b] = await Promise.all([c.getJson('x'), c.getJson('x')])
    expect(a).toEqual(b)
    expect(calls).toHaveLength(1)
    expect(onRequest).toHaveBeenCalledTimes(1)
  })

  it('retries a 5xx once, then succeeds', async () => {
    let n = 0
    const { c, calls } = client({ '/x': () => (++n === 1 ? json({}, 503) : json({ ok: true })) })
    await expect(c.getJson('x')).resolves.toEqual({ ok: true })
    expect(calls).toHaveLength(2)
  })

  it('waits out a short Retry-After on 429', async () => {
    let n = 0
    const sleep = vi.fn(noSleep)
    const { c } = client(
      { '/x': () => (++n === 1 ? json({}, 429, { 'retry-after': '3' }) : json({ ok: 1 })) },
      { sleep },
    )
    await expect(c.getJson('x')).resolves.toEqual({ ok: 1 })
    expect(sleep).toHaveBeenCalledWith(3000)
  })

  it('gives up on a long Retry-After and reports it', async () => {
    const { c, calls } = client({ '/x': () => json({}, 429, { 'retry-after': '1800' }) })
    await expect(c.getJson('x')).rejects.toMatchObject({ kind: 'rate_limited', retryAfterSec: 1800 })
    expect(calls).toHaveLength(1)
  })

  it('maps 401 to unauthorized and keeps the key out of the message', async () => {
    const { c } = client({ '/x': () => json({ message: 'Invalid API key' }, 401) })
    const error = (await c.getJson('x').catch((e: unknown) => e)) as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error.kind).toBe('unauthorized')
    expect(error.message).not.toContain(KEY)
  })

  it('retries a network failure once before giving up', async () => {
    const { c, calls } = client({
      '/x': () => {
        throw new TypeError('fetch failed')
      },
    })
    await expect(c.getJson('x')).rejects.toMatchObject({ kind: 'network' })
    expect(calls).toHaveLength(2)
  })
})

describe('parseRetryAfter', () => {
  it('accepts seconds and HTTP dates', () => {
    const now = Date.parse('2026-10-11T12:00:00Z')
    expect(parseRetryAfter('120', now)).toBe(120)
    expect(parseRetryAfter('Sun, 11 Oct 2026 12:01:00 GMT', now)).toBe(60)
    expect(parseRetryAfter('soon', now)).toBeUndefined()
    expect(parseRetryAfter(null, now)).toBeUndefined()
  })
})
