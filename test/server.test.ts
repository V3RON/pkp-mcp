import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { PdpClient } from '../src/api/client.ts'
import { Budget } from '../src/cache/budget.ts'
import { openMemoryDb } from '../src/cache/db.ts'
import { ScheduleCache } from '../src/cache/scheduleCache.ts'
import { TtlCache } from '../src/cache/ttlCache.ts'
import { Live } from '../src/data/live.ts'
import { Places } from '../src/data/places.ts'
import { Timetables } from '../src/data/timetables.ts'
import { DataVersion } from '../src/data/version.ts'
import { createServer } from '../src/server.ts'
import {
  catalogueRoutes,
  fakeFetch,
  json,
  noSleep,
  type RouteSpec,
  schedules,
  shortSchedules,
} from './helpers.ts'

// Sunday 2026-10-11, 10:00 in Warsaw.
const NOW = Date.parse('2026-10-11T08:00:00Z')

async function connect(
  options: { apiKey?: string | undefined; routes?: Parameters<typeof fakeFetch>[0] } = {},
) {
  const fake = fakeFetch({ ...catalogueRoutes, ...options.routes })
  const client = new PdpClient({
    baseUrl: 'https://api.test',
    apiKey: 'apiKey' in options ? options.apiKey : 'k',
    fetch: fake.fetch,
    sleep: noSleep,
  })
  const db = openMemoryDb()
  const server = createServer({
    client,
    places: new Places(db, client),
    timetables: new Timetables(
      client,
      new ScheduleCache(db, new DataVersion(db, client, () => NOW), () => NOW),
    ),
    live: new Live(client, new TtlCache(db, () => NOW), new Budget(undefined)),
    now: () => NOW,
  })
  const mcp = new Client({ name: 'test', version: '0' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(a), mcp.connect(b)])
  return Object.assign(mcp, { calls: fake.calls })
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as { type: string; text: string }[]).map((c) => c.text).join('\n')
}

describe('MCP server', () => {
  it('exposes compact tool definitions without output schemas', async () => {
    const mcp = await connect()
    const { tools } = await mcp.listTools()
    expect(tools.map((t) => t.name)).toEqual([
      'search_connections',
      'station_board',
      'train_details',
      'find_station',
    ])
    expect(tools.every((t) => t.outputSchema === undefined)).toBe(true)
    // Every definition is sent with every model request: keep the total small.
    expect(JSON.stringify(tools).length).toBeLessThan(4800)
  })

  it('answers find_station with compact text lines', async () => {
    const mcp = await connect()
    const result = await mcp.callTool({ name: 'find_station', arguments: { query: 'krakow' } })
    expect(textOf(result)).toBe(
      [
        'Matches for "krakow":',
        'Kraków — city, 2 stations',
        '33019 Kraków Główny',
        '33035 Kraków Płaszów',
      ].join('\n'),
    )
  })

  it('explains how to get a key when none is configured', async () => {
    const mcp = await connect({ apiKey: undefined })
    const result = await mcp.callTool({ name: 'find_station', arguments: { query: 'krakow' } })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('https://pdp-api.plk-sa.pl/')
  })

  it('reports a rejected key as a tool error', async () => {
    const mcp = await connect({
      routes: { '/api/v1/dictionaries/stations': () => json({ message: 'bad key' }, 401) },
    })
    const result = await mcp.callTool({ name: 'find_station', arguments: { query: 'krakow' } })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('401')
  })

  it('searches direct connections between a station and a city with one schedules request', async () => {
    const routes: RouteSpec[] = [
      {
        orderId: 101,
        number: '3510',
        category: 'EIP',
        name: 'Mehoffer',
        dates: ['2026-10-11'],
        stops: [
          [33019, null, '11:12', { departurePlatform: '3', departureTrack: '5' }],
          [34868, '13:30', '13:31'],
          [33605, '13:39', null, { arrivalPlatform: '2' }],
        ],
      },
      {
        orderId: 102,
        number: '1302',
        dates: ['2026-10-11'],
        stops: [
          [33019, null, '09:00'],
          [33605, '11:40', null],
        ],
      },
      {
        orderId: 103,
        number: '1304',
        dates: ['2026-10-11'],
        stops: [
          [33019, null, '15:00'],
          [33605, '17:20', null],
        ],
      },
    ]
    const mcp = await connect({ routes: { '/api/v1/schedules': () => json(schedules(routes)) } })
    const result = await mcp.callTool({
      name: 'search_connections',
      arguments: { from: 'Kraków Główny', to: 'Warszawa', limit: 1 },
    })
    expect(textOf(result)).toBe(
      [
        'Kraków Główny → Warszawa (all stations) · Sun 2026-10-11 · 1 of 2 direct trains',
        '11:12→13:30 2h18 · EIP 3510 "Mehoffer" (IC) · pl.3 tr.5 → Warszawa Zachodnia · ref 26/101/2026-10-11',
        'More: depart_after=11:13',
      ].join('\n'),
    )
    const request = mcp.calls.find((c) => c.url.pathname === '/api/v1/schedules')?.url.searchParams
    expect(Object.fromEntries(request ?? [])).toEqual({
      dateFrom: '2026-10-10',
      dateTo: '2026-10-11',
      fromStations: '33019',
      toStations: '33506,33605,34587,34868',
    })

    // A second question about the same pair and day is answered from the cache.
    await mcp.callTool({
      name: 'search_connections',
      arguments: { from: 'Kraków Główny', to: 'Warszawa', sort: 'duration' },
    })
    expect(mcp.calls.filter((c) => c.url.pathname === '/api/v1/schedules')).toHaveLength(1)
  })

  it('with only arrive_before, shows the last trains that make it, never ones already gone', async () => {
    const routes: RouteSpec[] = [
      {
        orderId: 1,
        number: 'gone',
        dates: ['2026-10-11'],
        stops: [
          [33019, null, '08:00'],
          [33605, '10:30', null],
        ],
      },
      {
        orderId: 2,
        number: 'early',
        dates: ['2026-10-11'],
        stops: [
          [33019, null, '11:00'],
          [33605, '13:30', null],
        ],
      },
      {
        orderId: 3,
        number: 'late',
        dates: ['2026-10-11'],
        stops: [
          [33019, null, '13:00'],
          [33605, '15:30', null],
        ],
      },
      {
        orderId: 4,
        number: 'toolate',
        dates: ['2026-10-11'],
        stops: [
          [33019, null, '15:00'],
          [33605, '17:30', null],
        ],
      },
    ]
    const mcp = await connect({ routes: { '/api/v1/schedules': () => json(schedules(routes)) } })
    const result = await mcp.callTool({
      name: 'search_connections',
      arguments: { from: 'Kraków Główny', to: 'Warszawa Centralna', arrive_before: '16:00', limit: 1 },
    })
    expect(textOf(result).split('\n').slice(1)).toEqual([
      '13:00→15:30 2h30 · IC late (IC) · ref 26/3/2026-10-11',
      'Earlier: arrive_before=15:29',
    ])
  })

  it('suggests valid categories when a filter matches nothing', async () => {
    const routes: RouteSpec[] = [
      {
        orderId: 1,
        category: 'TLK',
        dates: ['2026-10-12'],
        stops: [
          [33019, null, '09:00'],
          [33605, '11:40', null],
        ],
      },
    ]
    const mcp = await connect({ routes: { '/api/v1/schedules': () => json(schedules(routes)) } })
    const result = await mcp.callTool({
      name: 'search_connections',
      arguments: {
        from: 'Kraków Główny',
        to: 'Warszawa Centralna',
        date: '2026-10-12',
        categories: ['EIP'],
        max_transfers: 0,
      },
    })
    expect(textOf(result)).toBe(
      [
        'No direct trains Kraków Główny → Warszawa Centralna on Mon 2026-10-12.',
        'Categories here: TLK.',
      ].join('\n'),
    )
  })

  it('rejects ambiguous places and bad input with a one-line reason', async () => {
    const mcp = await connect()
    const ambiguous = await mcp.callTool({
      name: 'search_connections',
      arguments: { from: 'Kra', to: 'Łódź' },
    })
    expect(ambiguous.isError).toBe(true)
    expect(textOf(ambiguous)).toBe(
      '"Kra" is ambiguous: Kraków (city), Kraśnik, Kraków Główny, Kraków Płaszów. Use a more specific name or a station ID.',
    )
    const badDate = await mcp.callTool({
      name: 'search_connections',
      arguments: { from: 'Kraków', to: 'Łódź', date: '12.10.2026' },
    })
    expect(textOf(badDate)).toBe('Invalid date "12.10.2026". Use YYYY-MM-DD.')
  })

  it('shows a departure board with destinations and platforms', async () => {
    const routes: RouteSpec[] = [
      {
        orderId: 201,
        number: '1302',
        dates: ['2026-10-11'],
        stops: [
          [60111, null, '06:00'],
          [33019, '10:00', '10:05', { departurePlatform: '4' }],
          [33605, '12:40', null],
        ],
      },
      {
        orderId: 202,
        category: 'R',
        carrier: 'PR',
        number: '33612',
        dates: ['2026-10-11'],
        stops: [
          [33019, null, '10:20'],
          [70001, '13:00', null],
        ],
      },
      {
        orderId: 203,
        number: '9',
        dates: ['2026-10-11'],
        stops: [
          [33019, null, '09:00'],
          [33605, '11:00', null],
        ],
      },
    ]
    const mcp = await connect({ routes: { '/api/v1/schedules': () => json(schedules(routes)) } })
    const result = await mcp.callTool({ name: 'station_board', arguments: { station: 'krakow glowny' } })
    expect(textOf(result)).toBe(
      [
        'Kraków Główny · departures · Sun 2026-10-11 · 2',
        '10:05 · IC 1302 (IC) · → Warszawa Centralna · pl.4 · ref 26/201/2026-10-11',
        '10:20 · R 33612 (PR) · → Kraśnik · ref 26/202/2026-10-11',
      ].join('\n'),
    )
    const request = mcp.calls.find((c) => c.url.pathname === '/api/v1/schedules')?.url.searchParams
    expect(request?.get('stations')).toBe('33019')
    expect(request?.get('fullRoute')).toBe('true')
  })

  it('falls back to trimmed routes when fullRoute returns routes without stops', async () => {
    const trimmed: RouteSpec[] = [
      { orderId: 1, number: '5', dates: ['2026-10-11'], stops: [[33019, '11:00', '11:02']] },
    ]
    const broken = {
      ...schedules(trimmed),
      routes: schedules(trimmed).routes.map((r) => ({ ...r, stations: [] })),
    }
    const mcp = await connect({
      routes: {
        '/api/v1/schedules': (url) => json(url.searchParams.get('fullRoute') ? broken : schedules(trimmed)),
      },
    })
    const result = await mcp.callTool({ name: 'station_board', arguments: { station: 'Kraków Główny' } })
    expect(textOf(result)).toContain('11:02 · IC 5 (IC) · ref 26/1/2026-10-11')
  })

  it('adds journeys with changes from the whole-network timetable when direct trains are too few', async () => {
    // Bielsko-Biała Główna (60111) → Łódź Kaliska (38661): no direct train; change at Kraków Główny (33019).
    const network: RouteSpec[] = [
      {
        orderId: 301,
        category: 'R',
        carrier: 'KS',
        number: '40101',
        dates: ['2026-10-11'],
        stops: [
          [60111, null, '11:00', { departurePlatform: '1' }],
          [33019, '12:50', null, { arrivalPlatform: '2' }],
        ],
      },
      {
        orderId: 302,
        category: 'TLK',
        number: '18100',
        dates: ['2026-10-11'],
        stops: [
          [33019, null, '13:10', { departurePlatform: '4' }],
          [38661, '16:20', null],
        ],
      },
      // Too tight a change (3 min) for the default 5-minute minimum.
      {
        orderId: 303,
        number: '18102',
        dates: ['2026-10-11'],
        stops: [
          [33019, null, '12:53'],
          [38661, '15:50', null],
        ],
      },
    ]
    const mcp = await connect({
      routes: {
        '/api/v1/schedules': () => json(schedules([])),
        '/api/v1/schedules/shortened': () => json(shortSchedules(network)),
      },
    })
    const args = { from: 'Bielsko-Biała Główna', to: 'Łódź Kaliska' }
    const result = await mcp.callTool({ name: 'search_connections', arguments: args })
    expect(textOf(result)).toBe(
      [
        'Bielsko-Biała Główna → Łódź Kaliska · Sun 2026-10-11 · 1 option',
        '11:00→16:20 5h20 · 1 change: Kraków Główny',
        '  11:00 R 40101 (KS) pl.1 → Kraków Główny 12:50 pl.2 · ref 26/301/2026-10-11',
        '  13:10 TLK 18100 (IC) pl.4 → Łódź Kaliska 16:20 · ref 26/302/2026-10-11',
      ].join('\n'),
    )
    const network1 = mcp.calls.find((c) => c.url.pathname === '/api/v1/schedules/shortened')?.url.searchParams
    expect(Object.fromEntries(network1 ?? [])).toEqual({
      dateFrom: '2026-10-10',
      dateTo: '2026-10-11',
      dictionaries: 'false',
      fullRoute: 'true',
    })

    // With a 2-minute minimum the tighter change becomes possible and arrives earlier.
    const tight = await mcp.callTool({
      name: 'search_connections',
      arguments: { ...args, min_transfer_min: 2 },
    })
    expect(textOf(tight)).toContain('11:00→15:50 4h50 · 1 change: Kraków Główny')

    // Once the network is cached, later searches for that date make no requests at all.
    const before = mcp.calls.length
    await mcp.callTool({
      name: 'search_connections',
      arguments: { from: 'Kraków Główny', to: 'Łódź Kaliska' },
    })
    expect(mcp.calls.length).toBe(before)
  })

  describe('train_details', () => {
    // Bielsko-Biała Główna 06:00 → Kraków Główny 10:00/10:05 → Warszawa Centralna 12:40.
    const route = schedules([
      {
        orderId: 201,
        number: '1302',
        name: 'Wawel',
        dates: ['2026-10-11', '2026-10-12'],
        stops: [
          [60111, null, '06:00', { departurePlatform: '1' }],
          [33019, '10:00', '10:05', { departurePlatform: '4', departureTrack: '7' }],
          [34868, '12:30', '12:31', { stopTypeName: 'postój techniczny' }],
          [33605, '12:40', null, { arrivalPlatform: '2' }],
        ],
      },
    ]).routes[0]
    const operation = {
      scheduleId: 26,
      orderId: 201,
      trainOrderId: 201,
      operatingDate: '2026-10-11',
      trainStatus: 'P',
      stations: [
        { stationId: 60111, actualDeparture: '2026-10-11T06:02:00', isConfirmed: true, isCancelled: false },
        {
          stationId: 33019,
          actualArrival: '2026-10-11T10:07:00',
          departureDelayMinutes: null,
          isConfirmed: true,
          isCancelled: false,
        },
      ],
    }
    const disruptions = {
      disruptions: [
        {
          disruptionId: 1,
          disruptionTypeCode: 'utr_1',
          message: 'Zmiana peronu w Warszawie Centralnej.',
          affectedRoutes: [{ scheduleId: 26, orderId: 201, operatingDate: '2026-10-11', stationId: 33605 }],
        },
        {
          disruptionId: 2,
          message: 'Inny pociąg.',
          affectedRoutes: [{ scheduleId: 26, orderId: 999, operatingDate: '2026-10-11', stationId: 1 }],
        },
      ],
      disruptionTypes: { utr_1: 'Zmiana peronu' },
    }
    const routes = {
      '/api/v1/schedules/route/26/201': () => json(route),
      '/api/v1/operations/train/26/201/2026-10-11': () => json(operation),
      '/api/v1/disruptions': () => json(disruptions),
    }

    it('shows stops, live delay and disruptions for a ref', async () => {
      const mcp = await connect({ routes })
      const result = await mcp.callTool({ name: 'train_details', arguments: { ref: '26/201/2026-10-11' } })
      expect(textOf(result)).toBe(
        [
          'IC 1302 "Wawel" (IC) · Sun 2026-10-11 · ref 26/201/2026-10-11',
          'Live: running, +7 min at Kraków Główny',
          '06:00 Bielsko-Biała Główna pl.1 +2',
          '10:00–10:05 Kraków Główny pl.4 tr.7',
          '12:40 Warszawa Centralna pl.2',
          'Disruption (Zmiana peronu): Zmiana peronu w Warszawie Centralnej.',
        ].join('\n'),
      )
    })

    it('trims to the requested segment and skips live data when asked', async () => {
      const mcp = await connect({ routes })
      const result = await mcp.callTool({
        name: 'train_details',
        arguments: { ref: '26/201/2026-10-11', from: 'Kraków', to: 'Warszawa', live: false },
      })
      expect(textOf(result).split('\n').slice(1)).toEqual([
        '10:00–10:05 Kraków Główny pl.4 tr.7',
        '12:40 Warszawa Centralna pl.2',
      ])
      expect(mcp.calls.some((c) => c.url.pathname.startsWith('/api/v1/operations'))).toBe(false)
    })

    it('checks only disruptions for a future date', async () => {
      const mcp = await connect({ routes })
      const result = await mcp.callTool({ name: 'train_details', arguments: { ref: '26/201/2026-10-12' } })
      expect(textOf(result)).not.toContain('Live:')
      expect(mcp.calls.some((c) => c.url.pathname.startsWith('/api/v1/operations'))).toBe(false)
      expect(mcp.calls.some((c) => c.url.pathname === '/api/v1/disruptions')).toBe(true)
    })

    it('notes when a train has no live data yet', async () => {
      const mcp = await connect({
        routes: { ...routes, '/api/v1/operations/train/26/201/2026-10-11': () => json({}, 404) },
      })
      const result = await mcp.callTool({ name: 'train_details', arguments: { ref: '26/201/2026-10-11' } })
      expect(textOf(result)).toContain('No live data for this train yet.')
    })

    it('finds a train by number via the whole-network timetable', async () => {
      const network: RouteSpec[] = [
        {
          orderId: 201,
          number: '1302',
          dates: ['2026-10-11'],
          stops: [
            [33019, null, '10:05'],
            [33605, '12:40', null],
          ],
        },
        {
          orderId: 202,
          number: '1304',
          dates: ['2026-10-11'],
          stops: [
            [33019, null, '11:05'],
            [33605, '13:40', null],
          ],
        },
      ]
      const mcp = await connect({
        routes: { '/api/v1/schedules/shortened': () => json(shortSchedules(network)) },
      })
      const result = await mcp.callTool({
        name: 'train_details',
        arguments: { number: 'IC 1304', live: false },
      })
      expect(textOf(result).split('\n')[0]).toBe('IC 1304 (IC) · Sun 2026-10-11 · ref 26/202/2026-10-11')
      const missing = await mcp.callTool({
        name: 'train_details',
        arguments: { number: '9999', live: false },
      })
      expect(textOf(missing)).toBe('No train number 9999 runs on 2026-10-11.')
    })

    it('rejects a malformed ref', async () => {
      const mcp = await connect()
      const result = await mcp.callTool({ name: 'train_details', arguments: { ref: 'IC 1302' } })
      expect(textOf(result)).toContain('Invalid ref "IC 1302"')
    })
  })

  it('adds live delays to a station board with one request', async () => {
    const routes: RouteSpec[] = [
      {
        orderId: 201,
        number: '1302',
        dates: ['2026-10-11'],
        stops: [
          [33019, null, '10:05'],
          [33605, '12:40', null],
        ],
      },
      {
        orderId: 202,
        number: '1304',
        dates: ['2026-10-11'],
        stops: [
          [33019, null, '10:20'],
          [33605, '13:00', null],
        ],
      },
    ]
    const operations = {
      pagination: { hasNextPage: false },
      trains: [
        {
          scheduleId: 26,
          orderId: 201,
          trainOrderId: 201,
          operatingDate: '2026-10-11',
          trainStatus: 'P',
          stations: [{ stationId: 33019, departureDelayMinutes: 12, isConfirmed: false, isCancelled: false }],
        },
        {
          scheduleId: 26,
          orderId: 202,
          trainOrderId: 202,
          operatingDate: '2026-10-11',
          trainStatus: 'X',
          stations: [{ stationId: 33019, isConfirmed: false, isCancelled: true }],
        },
      ],
    }
    const mcp = await connect({
      routes: {
        '/api/v1/schedules': () => json(schedules(routes)),
        '/api/v1/operations': () => json(operations),
      },
    })
    const result = await mcp.callTool({
      name: 'station_board',
      arguments: { station: 'Kraków Główny', live: true },
    })
    expect(textOf(result).split('\n').slice(1)).toEqual([
      '10:05 · +12 · IC 1302 (IC) · → Warszawa Centralna · ref 26/201/2026-10-11',
      '10:20 · cancelled · IC 1304 (IC) · → Warszawa Centralna · ref 26/202/2026-10-11',
    ])
    const request = mcp.calls.find((c) => c.url.pathname === '/api/v1/operations')?.url.searchParams
    expect(request?.get('stations')).toBe('33019')
    expect(request?.get('withPlanned')).toBe('true')
  })
})
