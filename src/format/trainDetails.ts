import type { Disruption, LiveTrain } from '../data/live.ts'
import { type Stop, type Trip, tripRef } from '../data/trips.ts'
import { formatClock, formatDate } from '../time.ts'
import { delayLabel, liveSummary } from './live.ts'
import { type NameOf, platformLabel, trainLabel } from './trains.ts'

const MAX_DISRUPTIONS = 3
const MAX_MESSAGE_CHARS = 300

export interface TrainView {
  trip: Trip
  stops: Stop[]
  live: LiveTrain | undefined
  disruptions: Disruption[]
  notes: string[]
  nameOf: NameOf
}

/**
 * EIP 3510 "Mehoffer" (IC) · Mon 2026-10-12 · ref 26/101/2026-10-12
 * Live: running, +7 min at Kielce
 * 06:12 Kraków Główny pl.3 tr.5
 * 07:30–07:32 Kielce +7
 * 08:39 Warszawa Centralna pl.2
 */
export function formatTrain(v: TrainView): string {
  const first = v.stops[0] ?? v.trip.stops[0]
  const lines = [
    `${first ? trainLabel(v.trip, first) : '?'} · ${formatDate(v.trip.operatingDate)} · ref ${tripRef(v.trip)}`,
  ]
  if (v.live) lines.push(`Live: ${liveSummary(v.trip, v.live, v.nameOf)}`)
  for (const stop of v.stops) {
    const time =
      stop.arr !== undefined && stop.dep !== undefined && stop.arr !== stop.dep
        ? `${formatClock(stop.arr)}–${formatClock(stop.dep)}`
        : formatClock((stop.dep ?? stop.arr) as number)
    const platform =
      stop.dep !== undefined
        ? platformLabel(stop.depPlatform, stop.depTrack)
        : platformLabel(stop.arrPlatform, stop.arrTrack)
    const delay = delayLabel(v.live, stop, stop.dep !== undefined ? 'dep' : 'arr')
    lines.push([time, v.nameOf(stop.stationId), platform, delay].filter(Boolean).join(' '))
  }
  for (const d of v.disruptions.slice(0, MAX_DISRUPTIONS)) {
    const message =
      d.message.length > MAX_MESSAGE_CHARS ? `${d.message.slice(0, MAX_MESSAGE_CHARS)}…` : d.message
    lines.push(`Disruption${d.type ? ` (${d.type})` : ''}: ${message}`)
  }
  lines.push(...v.notes)
  return lines.join('\n')
}
