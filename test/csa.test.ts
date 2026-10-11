import { describe, expect, it } from 'vitest'
import { schedulesResponse } from '../src/api/schemas.ts'
import { toTimetable } from '../src/data/trips.ts'
import { searchTransfers, type TransferQuery } from '../src/planner/csa.ts'
import { makeFilter } from '../src/planner/filters.ts'
import { buildNetwork } from '../src/planner/network.ts'
import type { Journey } from '../src/planner/types.ts'
import { formatClock } from '../src/time.ts'
import { type RouteSpec, schedules } from './helpers.ts'

const D = '2026-10-12'
const PREV = '2026-10-11'
// Stations: A=1, A2=2 (same city as A), B=3 (hub), C=4 (destination).

function search(routes: RouteSpec[], q: Partial<TransferQuery> = {}): string[] {
  const trips = toTimetable(schedulesResponse.parse(schedules(routes)), [PREV, D]).trips
  const result = searchTransfers(buildNetwork(trips, D), {
    fromIds: [1],
    toIds: [4],
    departAfter: 0,
    arriveBefore: undefined,
    maxTransfers: 1,
    minTransferMin: 5,
    filter: makeFilter(),
    limit: 5,
    exhaustive: false,
    ...q,
  })
  return result.journeys.map(show)
}

/** "08:00→12:00 X>Y" — departure, arrival and train numbers. */
function show(j: Journey): string {
  return `${formatClock(j.dep)}→${formatClock(j.arr)} ${j.legs.map((l) => l.trip.number).join('>')}`
}

const AB = (n: string, dep: string, arr: string, extra: Partial<RouteSpec> = {}): RouteSpec => ({
  orderId: Number(n.replace(/\D/g, '')) || 1,
  number: n,
  dates: [D],
  stops: [
    [1, null, dep],
    [3, arr, null],
  ],
  ...extra,
})
const BC = (n: string, dep: string, arr: string, extra: Partial<RouteSpec> = {}): RouteSpec => ({
  orderId: Number(n.replace(/\D/g, '')) || 1,
  number: n,
  dates: [D],
  stops: [
    [3, null, dep],
    [4, arr, null],
  ],
  ...extra,
})

describe('searchTransfers', () => {
  it('finds a journey with one change and respects the minimum change time', () => {
    const routes = [AB('x1', '08:00', '09:00'), BC('y2', '09:03', '10:00'), BC('y3', '09:10', '10:30')]
    expect(search(routes)).toEqual(['08:00→10:30 x1>y3'])
    expect(search(routes, { minTransferMin: 2 })).toEqual(['08:00→10:00 x1>y2'])
  })

  it('finds nothing with changes when max_transfers is 0', () => {
    expect(search([AB('x1', '08:00', '09:00'), BC('y2', '09:30', '10:00')], { maxTransfers: 0 })).toEqual([])
  })

  it('keeps a slower direct train next to a faster journey with a change', () => {
    const direct: RouteSpec = {
      orderId: 9,
      number: 'd9',
      dates: [D],
      stops: [
        [1, null, '08:00'],
        [4, '12:00', null],
      ],
    }
    expect(search([direct, AB('x1', '08:05', '09:00'), BC('y2', '09:10', '10:00')])).toEqual([
      '08:00→12:00 d9',
      '08:05→10:00 x1>y2',
    ])
  })

  it('drops a journey with a change when a direct train is at least as good', () => {
    const direct: RouteSpec = {
      orderId: 9,
      number: 'd9',
      dates: [D],
      stops: [
        [1, null, '08:00'],
        [4, '10:00', null],
      ],
    }
    expect(search([direct, AB('x1', '07:00', '08:00'), BC('y2', '08:30', '10:00')])).toEqual([
      '08:00→10:00 d9',
    ])
  })

  it('prefers the latest departure that still makes the same arrival', () => {
    const routes = [AB('x1', '07:00', '07:30'), AB('x2', '08:00', '08:30'), BC('y3', '09:00', '10:00')]
    expect(search(routes)).toEqual(['08:00→10:00 x2>y3'])
  })

  it('boards a city origin at whichever of its stations works', () => {
    const fromA2: RouteSpec = {
      orderId: 5,
      number: 'z5',
      dates: [D],
      stops: [
        [2, null, '08:20'],
        [3, '08:40', null],
      ],
    }
    expect(search([fromA2, BC('y3', '09:00', '10:00')], { fromIds: [1, 2] })).toEqual(['08:20→10:00 z5>y3'])
  })

  it('never "changes" onto the train it is already on', () => {
    const through: RouteSpec = {
      orderId: 7,
      number: 't7',
      dates: [D],
      stops: [
        [1, null, '08:00'],
        [3, '09:00', '09:20'],
        [4, '10:00', null],
      ],
    }
    expect(search([through])).toEqual(['08:00→10:00 t7'])
  })

  it('applies category filters to every train of the journey', () => {
    const routes = [
      AB('x1', '08:00', '09:00', { category: 'R' }),
      BC('y2', '09:10', '10:00', { category: 'IC' }),
    ]
    expect(search(routes, { filter: makeFilter(['IC']) })).toEqual([])
    expect(search(routes, { filter: makeFilter(['IC', 'R']) })).toEqual(['08:00→10:00 x1>y2'])
  })

  it('boards a previous-day train after midnight and continues past midnight into the next day', () => {
    const night: RouteSpec = {
      orderId: 8,
      number: 'n8',
      dates: [PREV],
      stops: [
        [1, null, '24:20'],
        [3, '25:00', null],
      ],
    }
    expect(search([night, BC('y2', '05:00', '06:00')])).toEqual(['00:20→06:00 n8>y2'])

    const late: RouteSpec = {
      orderId: 9,
      number: 'l9',
      dates: [D],
      stops: [
        [3, null, '24:30'],
        [4, '25:30', null],
      ],
    }
    expect(search([AB('x1', '23:00', '23:40'), late])).toEqual(['23:00→01:30+1 x1>l9'])
  })

  it('returns options in departure order with a flag when more exist', () => {
    const routes = ['06', '07', '08', '09'].flatMap((h, i) => [
      AB(`x${i}`, `${h}:00`, `${h}:30`),
      BC(`y${i}`, `${h}:40`, `${h}:59`),
    ])
    const trips = toTimetable(schedulesResponse.parse(schedules(routes)), [PREV, D]).trips
    const result = searchTransfers(buildNetwork(trips, D), {
      fromIds: [1],
      toIds: [4],
      departAfter: 0,
      arriveBefore: undefined,
      maxTransfers: 1,
      minTransferMin: 5,
      filter: makeFilter(),
      limit: 2,
      exhaustive: false,
    })
    expect(result.journeys.map(show)).toEqual(['06:00→06:59 x0>y0', '07:00→07:59 x1>y1'])
    expect(result.more).toBe(true)
  })

  it('collects the whole day for arrive-before searches', () => {
    const routes = ['06', '07', '08'].flatMap((h, i) => [
      AB(`x${i}`, `${h}:00`, `${h}:30`),
      BC(`y${i}`, `${h}:40`, `${h}:59`),
    ])
    expect(search(routes, { exhaustive: true, arriveBefore: 8 * 60 })).toEqual([
      '06:00→06:59 x0>y0',
      '07:00→07:59 x1>y1',
    ])
  })
})
