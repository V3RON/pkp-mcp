import { tripRef } from '../data/trips.ts'
import type { BoardEntry, BoardType } from '../planner/board.ts'
import { formatClock, formatDate } from '../time.ts'
import { placeLabel } from './connections.ts'
import { type NameOf, platformLabel, trainLabel } from './trains.ts'

export interface BoardView {
  stationLabel: string
  isCity: boolean
  type: BoardType
  date: string
  shown: BoardEntry[]
  total: number
  hint: string | undefined
  nameOf: NameOf
}

/**
 * Kraków Główny · departures · Mon 2026-10-12 · 10 of 85
 * 08:05 · EIP 3510 "Mehoffer" (IC) · → Warszawa Centralna · pl.3 tr.5 · ref 25/171034/2026-10-12
 */
export function formatBoard(v: BoardView): string {
  const count = v.shown.length === v.total ? `${v.total}` : `${v.shown.length} of ${v.total}`
  const lines = [`${placeLabel(v.stationLabel, v.isCity)} · ${v.type} · ${formatDate(v.date)} · ${count}`]
  const arrow = v.type === 'departures' ? '→' : '←'
  for (const e of v.shown) {
    const platform =
      v.type === 'departures'
        ? platformLabel(e.stop.depPlatform, e.stop.depTrack)
        : platformLabel(e.stop.arrPlatform, e.stop.arrTrack)
    lines.push(
      [
        formatClock(e.time),
        v.isCity ? v.nameOf(e.stop.stationId) : '',
        trainLabel(e.trip, e.stop),
        e.endpointId === undefined ? '' : `${arrow} ${v.nameOf(e.endpointId)}`,
        platform,
        `ref ${tripRef(e.trip)}`,
      ]
        .filter(Boolean)
        .join(' · '),
    )
  }
  if (v.hint) lines.push(v.hint)
  return lines.join('\n')
}
