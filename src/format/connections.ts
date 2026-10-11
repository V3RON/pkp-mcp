import { tripRef } from '../data/trips.ts'
import type { DirectJourney } from '../planner/direct.ts'
import { formatClock, formatDate, formatDuration } from '../time.ts'
import { type NameOf, platformLabel, trainLabel } from './trains.ts'

export interface ConnectionsView {
  fromLabel: string
  toLabel: string
  fromIsCity: boolean
  toIsCity: boolean
  date: string
  shown: DirectJourney[]
  total: number
  hint: string | undefined
  nameOf: NameOf
}

/**
 * Kraków Główny → Warszawa (all stations) · Mon 2026-10-12 · 2 of 31 direct trains
 * 06:12→08:39 2h27 · EIP 3510 "Mehoffer" (IC) · pl.3 → Warszawa Centralna pl.2 · ref 25/171034/2026-10-12
 */
export function formatConnections(v: ConnectionsView): string {
  const count = v.shown.length === v.total ? `${v.total}` : `${v.shown.length} of ${v.total}`
  const lines = [
    `${placeLabel(v.fromLabel, v.fromIsCity)} → ${placeLabel(v.toLabel, v.toIsCity)} · ${formatDate(v.date)} · ${count} direct ${v.total === 1 ? 'train' : 'trains'}`,
  ]
  for (const j of v.shown) {
    const fromSide = [
      v.fromIsCity ? v.nameOf(j.from.stationId) : '',
      platformLabel(j.from.depPlatform, j.from.depTrack),
    ]
    const toSide = [
      v.toIsCity ? v.nameOf(j.to.stationId) : '',
      platformLabel(j.to.arrPlatform, j.to.arrTrack),
    ]
    const from = fromSide.filter(Boolean).join(' ')
    const to = toSide.filter(Boolean).join(' ')
    const where = from || to ? `${from || '·'} → ${to || '·'}` : ''
    lines.push(
      [
        `${formatClock(j.dep)}→${formatClock(j.arr)} ${formatDuration(j.arr - j.dep)}`,
        trainLabel(j.trip, j.from),
        where,
        `ref ${tripRef(j.trip)}`,
      ]
        .filter(Boolean)
        .join(' · '),
    )
  }
  if (v.hint) lines.push(v.hint)
  return lines.join('\n')
}

export function placeLabel(name: string, isCity: boolean): string {
  return isCity ? `${name} (all stations)` : name
}
