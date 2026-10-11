import type { RouteJson, SchedulesJson } from '../api/schemas.ts'
import { DAY_MIN, daysBetween, parseDuration } from '../time.ts'

/** One stop of a train, times in minutes since 00:00 of the train's operating date. */
export interface Stop {
  stationId: number
  arr: number | undefined
  dep: number | undefined
  arrPlatform: string | undefined
  depPlatform: string | undefined
  arrTrack: string | undefined
  depTrack: string | undefined
  /** Train number and category can change along the route; these are the values when leaving this stop. */
  number: string | undefined
  category: string | undefined
  /** False for technical stops where passengers cannot board or alight. */
  passenger: boolean
}

/** One train run on one operating date. */
export interface Trip {
  scheduleId: number
  orderId: number
  trainOrderId: number | undefined
  operatingDate: string
  name: string | undefined
  carrier: string | undefined
  number: string | undefined
  category: string | undefined
  stops: Stop[]
}

export interface Timetable {
  trips: Trip[]
  /** Station names that came with the response (fallback when the catalogue lacks one). */
  stationNames: Map<number, string>
  categories: Map<string, string>
  carriers: Map<string, string>
}

/**
 * Stop types that are not open to passengers. The API only ships names (Polish), so this is a
 * name heuristic; verify against /dictionaries/stop-types with a real key (milestone 0).
 */
const NON_PASSENGER_STOP = /techn|służb|przelot|bez wymiany/i

/**
 * Expands routes into trips for the operating dates in `dates` (a route lists every date it runs).
 * Routes without stops (seen when the API's fullRoute option misbehaves) are dropped.
 */
export function toTimetable(json: SchedulesJson, dates: string[]): Timetable {
  const trips: Trip[] = []
  for (const route of json.routes ?? []) {
    const stops = toStops(route)
    if (stops.length === 0) continue
    const runs = route.operatingDates?.length ? dates.filter((d) => route.operatingDates?.includes(d)) : dates
    for (const operatingDate of runs) trips.push(toTrip(route, operatingDate, stops))
  }
  const dict = json.dictionaries
  const stationNames = new Map<number, string>()
  for (const [id, station] of Object.entries(dict?.stations ?? {})) {
    if (station.name) stationNames.set(Number(id), station.name)
  }
  return {
    trips,
    stationNames,
    categories: new Map(Object.entries(dict?.commercialCategories ?? {})),
    carriers: new Map(Object.entries(dict?.carriers ?? {})),
  }
}

function toTrip(route: RouteJson, operatingDate: string, stops: Stop[]): Trip {
  return {
    scheduleId: route.scheduleId,
    orderId: route.orderId,
    trainOrderId: route.trainOrderId ?? undefined,
    operatingDate,
    name: route.name?.trim() || undefined,
    carrier: route.carrierCode ?? undefined,
    number: route.nationalNumber ?? undefined,
    category: route.commercialCategorySymbol ?? undefined,
    stops,
  }
}

function toStops(route: RouteJson): Stop[] {
  const raw = [...(route.stations ?? [])].sort((a, b) => (a.orderNumber ?? 0) - (b.orderNumber ?? 0))
  return raw.map((s) => {
    const arrTime = parseDuration(s.arrivalTime)
    const depTime = parseDuration(s.departureTime)
    return {
      stationId: s.stationId,
      arr: arrTime === undefined ? undefined : (s.arrivalDay ?? 0) * DAY_MIN + arrTime,
      dep: depTime === undefined ? undefined : (s.departureDay ?? 0) * DAY_MIN + depTime,
      arrPlatform: s.arrivalPlatform?.trim() || undefined,
      depPlatform: s.departurePlatform?.trim() || undefined,
      arrTrack: s.arrivalTrack?.trim() || undefined,
      depTrack: s.departureTrack?.trim() || undefined,
      number: s.departureTrainNumber?.trim() || s.arrivalTrainNumber?.trim() || undefined,
      category: s.departureCommercialCategory?.trim() || s.arrivalCommercialCategory?.trim() || undefined,
      passenger: !NON_PASSENGER_STOP.test(s.stopTypeName ?? ''),
    }
  })
}

/** Minutes offset to convert a trip's times to minutes since 00:00 of `date`. */
export function offsetTo(trip: Trip, date: string): number {
  return daysBetween(date, trip.operatingDate) * DAY_MIN
}

/**
 * Short reference for follow-up calls: scheduleId/orderId/operatingDate, plus the train order ID
 * when it differs from the route's (needed for live data).
 */
export function tripRef(trip: Trip): string {
  const order =
    trip.trainOrderId !== undefined && trip.trainOrderId !== trip.orderId
      ? `${trip.orderId}-${trip.trainOrderId}`
      : `${trip.orderId}`
  return `${trip.scheduleId}/${order}/${trip.operatingDate}`
}

export interface TripRef {
  scheduleId: number
  orderId: number
  trainOrderId: number | undefined
  operatingDate: string
}

/** Inverse of `tripRef`: "26/171034/2026-10-12" or "26/171034-171035/2026-10-12". */
export function parseRef(ref: string): TripRef | undefined {
  const match = /^\s*(\d+)\/(\d+)(?:-(\d+))?\/(\d{4}-\d{2}-\d{2})\s*$/.exec(ref)
  if (!match) return undefined
  return {
    scheduleId: Number(match[1]),
    orderId: Number(match[2]),
    trainOrderId: match[3] === undefined ? undefined : Number(match[3]),
    operatingDate: match[4] as string,
  }
}
