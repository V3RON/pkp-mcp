import type { LiveStop, LiveTrain } from '../data/live.ts'
import type { Stop, Trip } from '../data/trips.ts'

export type Side = 'arr' | 'dep'

function liveStopFor(live: LiveTrain, stop: Stop): LiveStop | undefined {
  return live.stops.find((s) => s.stationId === stop.stationId)
}

/** Delay in minutes at a stop: the API's figure, else actual minus planned. Undefined when unknown. */
export function delayAt(live: LiveTrain, stop: Stop, side: Side): number | undefined {
  const ls = liveStopFor(live, stop)
  if (!ls) return undefined
  const reported = side === 'dep' ? ls.depDelay : ls.arrDelay
  if (reported !== undefined) return reported
  const actual = side === 'dep' ? ls.actualDep : ls.actualArr
  const planned = side === 'dep' ? stop.dep : stop.arr
  return actual !== undefined && planned !== undefined ? actual - planned : undefined
}

/** "+7", "-1", "cancelled", or '' when on time or unknown. */
export function delayLabel(live: LiveTrain | undefined, stop: Stop, side: Side): string {
  if (!live) return ''
  if (liveStopFor(live, stop)?.cancelled) return 'cancelled'
  const delay = delayAt(live, stop, side)
  if (delay === undefined || delay === 0) return ''
  return delay > 0 ? `+${delay}` : `${delay}`
}

const STATUS: Record<string, string> = {
  S: 'not started',
  P: 'running',
  C: 'arrived',
  X: 'cancelled',
  Q: 'partly cancelled',
}

/** "running, +7 min at Kielce" — status plus the delay at the last stop with an actual time. */
export function liveSummary(trip: Trip, live: LiveTrain, nameOf: (id: number) => string): string {
  const status = (live.status && STATUS[live.status]) ?? live.status ?? 'unknown'
  for (let i = trip.stops.length - 1; i >= 0; i--) {
    const stop = trip.stops[i] as Stop
    const ls = liveStopFor(live, stop)
    if (!ls || (ls.actualArr === undefined && ls.actualDep === undefined)) continue
    const side: Side = ls.actualDep !== undefined ? 'dep' : 'arr'
    const delay = delayAt(live, stop, side) ?? 0
    const delayText = delay > 0 ? `+${delay} min` : delay < 0 ? `${delay} min` : 'on time'
    return `${status}, ${delayText} at ${nameOf(stop.stationId)}`
  }
  return status
}
