import cities from './fixtures/cities.json' with { type: 'json' }
import stations from './fixtures/stations.json' with { type: 'json' }

export interface FakeCall {
  url: URL
  headers: Headers
}

type Handler = (url: URL) => Response | Promise<Response>

/** A fetch stand-in that records calls; routes by pathname. */
export function fakeFetch(routes: Record<string, Handler>) {
  const calls: FakeCall[] = []
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ url, headers: new Headers(init?.headers) })
    const handler = routes[url.pathname]
    if (!handler) return json({ error: 'NotFound' }, 404)
    return handler(url)
  }) as typeof fetch
  return { fetch: fn, calls }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

export const catalogueRoutes: Record<string, Handler> = {
  '/api/v1/dictionaries/stations': () => json(stations),
  '/api/v1/dictionaries/cities': () => json(cities),
}

export const noSleep = async () => {}
