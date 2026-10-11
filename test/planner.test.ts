import { describe, expect, it } from 'vitest'
import { schedulesResponse } from '../src/api/schemas.ts'
import { toTimetable, tripRef } from '../src/data/trips.ts'
import { buildBoard } from '../src/planner/board.ts'
import { findDirect } from '../src/planner/direct.ts'
import { makeFilter } from '../src/planner/filters.ts'
import { formatClock } from '../src/time.ts'
import { type RouteSpec, schedules } from './helpers.ts'

const D = '2026-10-12'
const PREV = '2026-10-11'
// Stations: Warszawa Wschodnia 1, Centralna 2, Zachodnia 3; Kielce 5; Kraków Główny 9.
const WARSZAWA = new Set([1, 2, 3])
const KRAKOW = new Set([9])

function trips(routes: RouteSpec[]) {
  return toTimetable(schedulesResponse.parse(schedules(routes)), [PREV, D]).trips
}

const direct = (routes: RouteSpec[], extra: Partial<Parameters<typeof findDirect>[1]> = {}) =>
  findDirect(trips(routes), {
    fromIds: WARSZAWA,
    toIds: KRAKOW,
    date: D,
    departAfter: undefined,
    arriveBefore: undefined,
    filter: makeFilter(),
    ...extra,
  }).map((j) => `${formatClock(j.dep)}→${formatClock(j.arr)} ${j.legs[0]?.trip.number}`)

describe('toTimetable', () => {
  it('expands routes into one trip per requested operating date', () => {
    const t = trips([
      {
        orderId: 1,
        dates: [PREV, D, '2026-10-13'],
        stops: [
          [1, null, '08:00'],
          [9, '10:30', null],
        ],
      },
    ])
    expect(t.map((x) => x.operatingDate)).toEqual([PREV, D])
  })

  it('applies day offsets and marks technical stops', () => {
    const [trip] = trips([
      {
        orderId: 1,
        dates: [D],
        stops: [
          [1, null, '23:50'],
          [5, '24:40', '24:41', { stopTypeName: 'postój techniczny' }],
          [9, '25:10', null],
        ],
      },
    ])
    expect(trip?.stops.map((s) => [s.arr, s.dep, s.passenger])).toEqual([
      [undefined, 1430, true],
      [1480, 1481, false],
      [1510, undefined, true],
    ])
  })

  it('drops routes that came without stops', () => {
    expect(trips([{ orderId: 1, dates: [D], stops: [] }])).toEqual([])
  })

  it('builds refs that carry the train order ID only when it differs', () => {
    const [a, b] = trips([
      { orderId: 7, dates: [D], stops: [[1, null, '08:00']] },
      { orderId: 8, trainOrderId: 81, dates: [D], stops: [[1, null, '08:00']] },
    ])
    expect([a && tripRef(a), b && tripRef(b)]).toEqual([`26/7/${D}`, `26/8-81/${D}`])
  })
})

describe('findDirect', () => {
  it('boards at the last origin-city station and leaves at the first destination station', () => {
    const result = findDirect(
      trips([
        {
          orderId: 1,
          dates: [D],
          stops: [
            [1, null, '06:00'],
            [2, '06:08', '06:10'],
            [3, '06:15', '06:16'],
            [9, '08:39', null],
          ],
        },
      ]),
      {
        fromIds: WARSZAWA,
        toIds: KRAKOW,
        date: D,
        departAfter: undefined,
        arriveBefore: undefined,
        filter: makeFilter(),
      },
    )
    expect(result.map((j) => [j.legs[0]?.from.stationId, j.legs[0]?.to.stationId, j.dep, j.arr])).toEqual([
      [3, 9, 376, 519],
    ])
  })

  it('ignores trains going the other way and technical stops', () => {
    expect(
      direct([
        {
          orderId: 1,
          number: 'back',
          dates: [D],
          stops: [
            [9, null, '07:00'],
            [2, '09:30', null],
          ],
        },
        {
          orderId: 2,
          number: 'tech',
          dates: [D],
          stops: [
            [2, null, '07:00'],
            [9, '09:30', '09:31', { stopTypeName: 'Postój techniczny' }],
          ],
        },
        {
          orderId: 3,
          number: 'ok',
          dates: [D],
          stops: [
            [2, null, '07:05'],
            [9, '09:30', null],
          ],
        },
      ]),
    ).toEqual(['07:05→09:30 ok'])
  })

  it('includes overnight trains from the previous operating day that leave after midnight', () => {
    expect(
      direct([
        {
          orderId: 1,
          number: 'night',
          dates: [PREV],
          stops: [
            [2, null, '24:30'],
            [9, '27:10', null],
          ],
        },
        {
          orderId: 2,
          number: 'yesterday',
          dates: [PREV],
          stops: [
            [2, null, '22:00'],
            [9, '24:30', null],
          ],
        },
      ]),
    ).toEqual(['00:30→03:10 night'])
  })

  it('applies the time window and category/carrier filters', () => {
    const routes: RouteSpec[] = [
      {
        orderId: 1,
        number: '1',
        category: 'TLK',
        carrier: 'IC',
        dates: [D],
        stops: [
          [2, null, '06:00'],
          [9, '09:00', null],
        ],
      },
      {
        orderId: 2,
        number: '2',
        category: 'EIP',
        carrier: 'IC',
        dates: [D],
        stops: [
          [2, null, '08:00'],
          [9, '10:20', null],
        ],
      },
      {
        orderId: 3,
        number: '3',
        category: 'R',
        carrier: 'PR',
        dates: [D],
        stops: [
          [2, null, '09:00'],
          [9, '13:00', null, { arrivalCommercialCategory: 'R' }],
        ],
      },
    ]
    expect(direct(routes, { departAfter: 7 * 60 })).toEqual(['08:00→10:20 2', '09:00→13:00 3'])
    expect(direct(routes, { arriveBefore: 10 * 60 + 30 })).toEqual(['06:00→09:00 1', '08:00→10:20 2'])
    expect(direct(routes, { filter: makeFilter(['eip', 'tlk']) })).toEqual(['06:00→09:00 1', '08:00→10:20 2'])
    expect(direct(routes, { filter: makeFilter(undefined, ['PR']) })).toEqual(['09:00→13:00 3'])
  })
})

describe('buildBoard', () => {
  const routes: RouteSpec[] = [
    {
      orderId: 1,
      number: 'A',
      dates: [D],
      stops: [
        [1, null, '06:00'],
        [2, '06:08', '06:10'],
        [9, '08:39', null],
      ],
    },
    {
      orderId: 2,
      number: 'B',
      dates: [D],
      stops: [
        [9, null, '05:00'],
        [2, '07:30', '07:35'],
        [5, '09:00', null],
      ],
    },
    {
      orderId: 3,
      number: 'C',
      dates: [D],
      stops: [
        [2, null, '23:59'],
        [9, '26:00', null],
      ],
    },
  ]
  const board = (type: 'departures' | 'arrivals', fromTime = 0, toTime?: number) =>
    buildBoard(trips(routes), {
      stationIds: new Set([2]),
      date: D,
      type,
      fromTime,
      toTime,
      filter: makeFilter(),
    }).map((e) => `${formatClock(e.time)} ${e.trip.number} ${e.endpointId ?? '-'}`)

  it('lists departures with destinations and arrivals with origins', () => {
    expect(board('departures')).toEqual(['06:10 A 9', '07:35 B 5', '23:59 C 9'])
    expect(board('arrivals')).toEqual(['06:08 A 1', '07:30 B 9'])
  })

  it('applies the time window', () => {
    expect(board('departures', 7 * 60, 12 * 60)).toEqual(['07:35 B 5'])
  })

  it('omits the endpoint when the route was trimmed to the station itself', () => {
    const trimmed = trips([{ orderId: 4, number: 'T', dates: [D], stops: [[2, '10:00', '10:02']] }])
    const entries = buildBoard(trimmed, {
      stationIds: new Set([2]),
      date: D,
      type: 'departures',
      fromTime: 0,
      toTime: undefined,
      filter: makeFilter(),
    })
    expect(entries.map((e) => e.endpointId)).toEqual([undefined])
  })
})
