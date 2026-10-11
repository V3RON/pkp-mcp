import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { PdpClient } from '../src/api/client.ts'
import { openMemoryDb } from '../src/cache/db.ts'
import { ScheduleCache } from '../src/cache/scheduleCache.ts'
import { Places } from '../src/data/places.ts'
import { Timetables } from '../src/data/timetables.ts'
import { DataVersion } from '../src/data/version.ts'
import { createServer } from '../src/server.ts'
import { catalogueRoutes, fakeFetch, json, noSleep, type RouteSpec, schedules } from './helpers.ts'

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
    expect(tools.map((t) => t.name)).toEqual(['search_connections', 'station_board', 'find_station'])
    expect(tools.every((t) => t.outputSchema === undefined)).toBe(true)
    // Every definition is sent with every model request: keep the total small.
    expect(JSON.stringify(tools).length).toBeLessThan(3500)
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
      arguments: { from: 'Kraków Główny', to: 'Warszawa Centralna', date: '2026-10-12', categories: ['EIP'] },
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
})
