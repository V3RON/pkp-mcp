import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Context } from './tools/context.ts'
import { registerFindStation } from './tools/findStation.ts'

export const SERVER_NAME = 'pkp-mcp'
export const SERVER_VERSION = '0.1.0'

const INSTRUCTIONS = [
  'Polish railway timetables from PKP PLK open data.',
  'All times are Europe/Warsaw local time.',
  'Pass station or city names directly to tools; diacritics are optional.',
  'Data source: PKP Polskie Linie Kolejowe S.A. Credit it if the user publishes the results.',
].join(' ')

export function createServer(ctx: Context): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS })
  registerFindStation(server, ctx)
  return server
}
