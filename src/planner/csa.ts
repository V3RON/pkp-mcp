import type { Stop } from '../data/trips.ts'
import { DAY_MIN } from '../time.ts'
import { passes, type TrainFilter } from './filters.ts'
import type { Network } from './network.ts'
import { type Journey, journeyOf, type Leg } from './types.ts'

export interface TransferQuery {
  fromIds: number[]
  toIds: number[]
  departAfter: number
  arriveBefore: number | undefined
  maxTransfers: number
  minTransferMin: number
  filter: TrainFilter
  /** Stop once this many options are found (plus one, to know whether there are more). */
  limit: number
  /** Collect every option of the day instead (used for "arrive before" searches). */
  exhaustive: boolean
}

export interface TransferResult {
  journeys: Journey[]
  /** True when more options exist after the last one returned. */
  more: boolean
}

const UNSET = -1
const NEVER = 2 ** 31 - 1

/**
 * Pareto-optimal journeys (later departure, earlier arrival, fewer changes) between two station
 * sets, using the Connection Scan Algorithm with a transfer limit. One scan finds the earliest
 * arrival for each number of legs; repeating it with a later departure collects further options
 * and exposes journeys that left needlessly early.
 */
export function searchTransfers(net: Network, q: TransferQuery): TransferResult {
  const sources = indexSet(net, q.fromIds)
  const targets = indexSet(net, q.toIds)
  if (sources.size === 0 || targets.size === 0) return { journeys: [], more: false }

  const found: Journey[] = []
  const maxRuns = q.exhaustive ? 300 : q.limit * 6 + 20
  let departAfter = q.departAfter
  for (let run = 0; run < maxRuns && departAfter < DAY_MIN; run++) {
    const runJourneys = scan(net, q, sources, targets, departAfter)
    if (runJourneys.length === 0) break
    for (const journey of runJourneys) addPareto(found, journey)
    departAfter = Math.min(...runJourneys.map((j) => j.dep)) + 1
    // Enough options, and every one that would be shown has been re-checked against later departures
    // (a later scan is what reveals a journey that left needlessly early).
    if (!q.exhaustive && found.length > q.limit && departAfter > nthDeparture(found, q.limit)) break
  }

  const journeys = found
    .filter((j) => q.arriveBefore === undefined || j.arr <= q.arriveBefore)
    .sort((a, b) => a.dep - b.dep || a.arr - b.arr || a.legs.length - b.legs.length)
  if (q.exhaustive) return { journeys, more: false }
  return { journeys: journeys.slice(0, q.limit), more: journeys.length > q.limit }
}

/** Departure of the n-th earliest journey (1-based). */
function nthDeparture(journeys: Journey[], n: number): number {
  return journeys.map((j) => j.dep).sort((a, b) => a - b)[n - 1] ?? Number.POSITIVE_INFINITY
}

function indexSet(net: Network, ids: number[]): Set<number> {
  const set = new Set<number>()
  for (const id of ids) {
    const index = net.stationIndex.get(id)
    if (index !== undefined) set.add(index)
  }
  return set
}

/**
 * One connection scan from `departAfter`; returns the best journey per number of legs that beats
 * every journey with fewer legs. Typed arrays are indexed in a hot loop, hence the `!` assertions.
 */
function scan(
  net: Network,
  q: TransferQuery,
  sources: Set<number>,
  targets: Set<number>,
  departAfter: number,
): Journey[] {
  const levels = q.maxTransfers + 1
  const stations = net.stationIds.length
  const level = (fill: number, size: number) =>
    Array.from({ length: levels }, () => new Int32Array(size).fill(fill))
  // Per level (legs - 1): earliest arrival per station and the hops of the trip that achieved it.
  const arrival = level(NEVER, stations)
  const exitHop = level(UNSET, stations)
  const enterHop = level(UNSET, stations)
  // Per level: hop at which each trip was boarded.
  const boarded = level(UNSET, net.trips.length)
  let best = NEVER

  for (let c = lowerBound(net.dep, departAfter); c < net.dep.length; c++) {
    const dep = net.dep[c]!
    if (dep > best) break
    const t = net.trip[c]!
    const from = net.from[c]!
    const to = net.to[c]!

    for (let l = 0; l < levels; l++) {
      if (boarded[l]![t] !== UNSET) continue
      const canBoard =
        l === 0
          ? sources.has(from) && dep < DAY_MIN
          : arrival[l - 1]![from]! + q.minTransferMin <= dep && net.trip[exitHop[l - 1]![from]!] !== t
      if (canBoard && passes(q.filter, net.trips[t]!, stopOf(net, c, 'from'))) boarded[l]![t] = c
    }

    const arr = net.arr[c]!
    for (let l = 0; l < levels; l++) {
      const enter = boarded[l]![t]!
      if (enter === UNSET || arr >= arrival[l]![to]!) continue
      arrival[l]![to] = arr
      exitHop[l]![to] = c
      enterHop[l]![to] = enter
      if (targets.has(to) && arr < best) best = arr
    }
  }

  const journeys: Journey[] = []
  let bestSoFar = NEVER
  for (let l = 0; l < levels; l++) {
    let target = UNSET
    let targetArr = NEVER
    for (const s of targets) {
      if (arrival[l]![s]! < targetArr) {
        target = s
        targetArr = arrival[l]![s]!
      }
    }
    // More changes must buy an earlier arrival.
    if (target === UNSET || targetArr >= bestSoFar) continue
    bestSoFar = targetArr
    journeys.push(reconstruct(net, exitHop, enterHop, l, target))
  }
  return journeys
}

function reconstruct(
  net: Network,
  exitHop: Int32Array[],
  enterHop: Int32Array[],
  level: number,
  target: number,
): Journey {
  const legs: Leg[] = []
  let station = target
  for (let l = level; l >= 0; l--) {
    const exit = exitHop[l]![station]!
    const enter = enterHop[l]![station]!
    legs.unshift({
      trip: net.trips[net.trip[exit]!]!,
      from: stopOf(net, enter, 'from'),
      to: stopOf(net, exit, 'to'),
      dep: net.dep[enter]!,
      arr: net.arr[exit]!,
    })
    station = net.from[enter]!
  }
  return journeyOf(legs)
}

function stopOf(net: Network, hop: number, side: 'from' | 'to'): Stop {
  const trip = net.trips[net.trip[hop]!]!
  return trip.stops[(side === 'from' ? net.fromStop : net.toStop)[hop]!]!
}

/** Adds `j` unless an existing journey dominates it; removes the ones it dominates. */
function addPareto(found: Journey[], j: Journey): void {
  for (const other of found) if (dominates(other, j) || sameJourney(other, j)) return
  for (let i = found.length - 1; i >= 0; i--) if (dominates(j, found[i]!)) found.splice(i, 1)
  found.push(j)
}

function dominates(a: Journey, b: Journey): boolean {
  const noWorse = a.dep >= b.dep && a.arr <= b.arr && a.legs.length <= b.legs.length
  const better = a.dep > b.dep || a.arr < b.arr || a.legs.length < b.legs.length
  return noWorse && better
}

function sameJourney(a: Journey, b: Journey): boolean {
  return (
    a.dep === b.dep &&
    a.arr === b.arr &&
    a.legs.length === b.legs.length &&
    a.legs.every((leg, i) => leg.trip === b.legs[i]?.trip && leg.from === b.legs[i]?.from)
  )
}

function lowerBound(values: Int32Array, target: number): number {
  let lo = 0
  let hi = values.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if ((values[mid] as number) < target) lo = mid + 1
    else hi = mid
  }
  return lo
}
