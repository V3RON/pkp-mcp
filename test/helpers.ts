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

/** [stationId, arrival "HH:MM" | null, departure "HH:MM" | null, extras] → API stop JSON. */
export type StopSpec = [number, string | null, string | null, Record<string, unknown>?]

export interface RouteSpec {
  scheduleId?: number
  orderId: number
  trainOrderId?: number
  name?: string
  carrier?: string
  category?: string
  number?: string
  dates: string[]
  stops: StopSpec[]
}

/** Builds a /schedules route the way the API shapes it (TimeSpan strings + day offsets). */
export function apiRoute(spec: RouteSpec) {
  return {
    scheduleId: spec.scheduleId ?? 26,
    orderId: spec.orderId,
    trainOrderId: spec.trainOrderId ?? spec.orderId,
    name: spec.name ?? null,
    carrierCode: spec.carrier ?? 'IC',
    nationalNumber: spec.number ?? String(spec.orderId),
    commercialCategorySymbol: spec.category ?? 'IC',
    operatingDates: spec.dates,
    stations: spec.stops.map(([stationId, arr, dep, extra], index) => ({
      stationId,
      orderNumber: index + 1,
      ...timeFields('arrival', arr),
      ...timeFields('departure', dep),
      ...extra,
    })),
  }
}

/** "25:10" means 01:10 on the next day, as the API does with a day offset. */
function timeFields(kind: 'arrival' | 'departure', value: string | null) {
  if (value === null) return { [`${kind}Time`]: null, [`${kind}Day`]: null }
  const [h = 0, mm = 0] = value.split(':').map(Number)
  const day = Math.floor(h / 24)
  return {
    [`${kind}Time`]: `${String(h % 24).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`,
    [`${kind}Day`]: day,
  }
}

export function schedules(routes: RouteSpec[]) {
  return { generatedAt: '2026-10-11T12:00:00Z', routes: routes.map(apiRoute), dictionaries: {} }
}
