import { type Stop, type Trip, tripRef } from '../data/trips.ts'
import type { Journey, Leg } from '../planner/types.ts'
import { formatClock, formatDate, formatDuration } from '../time.ts'
import { type NameOf, platformLabel, trainLabel } from './trains.ts'

export interface ConnectionsView {
  fromLabel: string
  toLabel: string
  fromIsCity: boolean
  toIsCity: boolean
  date: string
  shown: Journey[]
  /** Total matches when known (direct search); undefined for transfer search. */
  total: number | undefined
  /** Whether journeys with changes were searched. */
  withTransfers: boolean
  hint: string | undefined
  nameOf: NameOf
  /** Live delay at a departure stop ("+7", "cancelled"), when live data was requested. */
  delayOf?: ((trip: Trip, stop: Stop) => string) | undefined
}

/**
 * Direct trains take one line; journeys with changes add one indented line per train:
 *
 *   Kraków Główny → Gdańsk (all stations) · Mon 2026-10-12 · 2 options
 *   06:12→11:05 4h53 · EIC 3510 "Mehoffer" (IC) · pl.3 → Gdańsk Główny · ref 26/101/2026-10-12
 *   06:45→12:40 5h55 · 1 change: Warszawa Centralna
 *     06:45 R 33612 (PR) pl.1 → Warszawa Centralna 08:39 pl.2 · ref 26/102/2026-10-12
 *     08:55 IC 5100 (IC) pl.4 → Gdańsk Główny 12:40 · ref 26/103/2026-10-12
 */
export function formatConnections(v: ConnectionsView): string {
  const lines = [
    `${placeLabel(v.fromLabel, v.fromIsCity)} → ${placeLabel(v.toLabel, v.toIsCity)} · ${formatDate(v.date)} · ${countLabel(v)}`,
  ]
  for (const journey of v.shown) {
    const [first] = journey.legs
    if (journey.legs.length === 1 && first) lines.push(directLine(v, first))
    else lines.push(...transferLines(v, journey))
  }
  if (v.hint) lines.push(v.hint)
  return lines.join('\n')
}

function countLabel(v: ConnectionsView): string {
  if (v.withTransfers) return `${v.shown.length} ${v.shown.length === 1 ? 'option' : 'options'}`
  const total = v.total ?? v.shown.length
  const count = v.shown.length === total ? `${total}` : `${v.shown.length} of ${total}`
  return `${count} direct ${total === 1 ? 'train' : 'trains'}`
}

function directLine(v: ConnectionsView, leg: Leg): string {
  const from = [
    v.fromIsCity ? v.nameOf(leg.from.stationId) : '',
    platformLabel(leg.from.depPlatform, leg.from.depTrack),
  ]
    .filter(Boolean)
    .join(' ')
  const to = [
    v.toIsCity ? v.nameOf(leg.to.stationId) : '',
    platformLabel(leg.to.arrPlatform, leg.to.arrTrack),
  ]
    .filter(Boolean)
    .join(' ')
  return [
    `${formatClock(leg.dep)}→${formatClock(leg.arr)} ${formatDuration(leg.arr - leg.dep)}`,
    v.delayOf?.(leg.trip, leg.from) ?? '',
    trainLabel(leg.trip, leg.from),
    from || to ? `${from || '·'} → ${to || '·'}` : '',
    `ref ${tripRef(leg.trip)}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

function transferLines(v: ConnectionsView, journey: Journey): string[] {
  const changes = journey.legs.slice(1).map((leg) => v.nameOf(leg.from.stationId))
  const summary = `${formatClock(journey.dep)}→${formatClock(journey.arr)} ${formatDuration(journey.arr - journey.dep)} · ${changes.length} ${changes.length === 1 ? 'change' : 'changes'}: ${changes.join(', ')}`
  const legs = journey.legs.map((leg, i) => {
    const boarding = i === 0 && v.fromIsCity ? `${v.nameOf(leg.from.stationId)} ` : ''
    const depPlatform = platformLabel(leg.from.depPlatform, leg.from.depTrack)
    const arrPlatform = platformLabel(leg.to.arrPlatform, leg.to.arrTrack)
    const delay = v.delayOf?.(leg.trip, leg.from)
    return `  ${boarding}${formatClock(leg.dep)}${delay ? ` ${delay}` : ''} ${trainLabel(leg.trip, leg.from)}${depPlatform ? ` ${depPlatform}` : ''} → ${v.nameOf(leg.to.stationId)} ${formatClock(leg.arr)}${arrPlatform ? ` ${arrPlatform}` : ''} · ref ${tripRef(leg.trip)}`
  })
  return [summary, ...legs]
}

export function placeLabel(name: string, isCity: boolean): string {
  return isCity ? `${name} (all stations)` : name
}
