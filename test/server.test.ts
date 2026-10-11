import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { PdpClient } from '../src/api/client.ts'
import { openMemoryDb } from '../src/cache/db.ts'
import { Places } from '../src/data/places.ts'
import { LocaleResolver } from '../src/i18n/resolver.ts'
import { createServer } from '../src/server.ts'
import { catalogueRoutes, fakeFetch, json, noSleep } from './helpers.ts'

async function connect(
  options: { apiKey?: string | undefined; routes?: Parameters<typeof fakeFetch>[0]; lang?: string } = {},
) {
  const fake = fakeFetch(options.routes ?? catalogueRoutes)
  const client = new PdpClient({
    baseUrl: 'https://api.test',
    apiKey: 'apiKey' in options ? options.apiKey : 'k',
    fetch: fake.fetch,
    sleep: noSleep,
  })
  const db = openMemoryDb()
  const noOs = { home: '/nowhere', readFile: async () => '', exec: async () => '' }
  const server = createServer({
    client,
    places: new Places(db, client),
    locale: new LocaleResolver({}, options.lang, 'linux', noOs),
  })
  const mcp = new Client({ name: 'test', version: '0' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(a), mcp.connect(b)])
  return mcp
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as { type: string; text: string }[]).map((c) => c.text).join('\n')
}

describe('MCP server', () => {
  it('exposes find_station with a small, flat schema', async () => {
    const mcp = await connect()
    const { tools } = await mcp.listTools()
    expect(tools.map((t) => t.name)).toEqual(['find_station'])
    expect(Object.keys(tools[0]?.inputSchema.properties ?? {})).toEqual(['query', 'limit'])
    expect(tools[0]?.outputSchema).toBeUndefined()
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

  it('answers in Polish when configured', async () => {
    const mcp = await connect({ lang: 'pl' })
    const result = await mcp.callTool({ name: 'find_station', arguments: { query: 'Łódź', limit: 1 } })
    expect(textOf(result)).toBe(['Wyniki dla „Łódź” (1 z 3):', 'Łódź — miasto, 2 stacje'].join('\n'))
  })

  it('follows a per-request Accept-Language in _meta', async () => {
    const mcp = await connect()
    const result = await mcp.callTool({
      name: 'find_station',
      arguments: { query: 'xyz' },
      _meta: { 'io.modelcontextprotocol/acceptLanguage': 'pl' },
    })
    expect(textOf(result)).toBe('Brak stacji ani miasta pasujących do „xyz”.')
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
})
