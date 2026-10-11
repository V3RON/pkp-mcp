import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { formatPlaceSearch } from '../format/places.ts'
import type { Context } from './context.ts'
import { text, toolError } from './errors.ts'

export function registerFindStation(server: McpServer, ctx: Context): void {
  server.registerTool(
    'find_station',
    {
      title: 'Find station',
      description:
        'Look up Polish railway stations or cities by name. Only needed to disambiguate; other tools accept names directly.',
      inputSchema: {
        query: z.string().min(1).describe('Station or city name (diacritics optional), or a station ID'),
        limit: z.number().int().min(1).max(20).optional().describe('Max results, default 5'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, limit }, extra) => {
      const msgs = await ctx.locale.messagesFor(extra._meta)
      try {
        const result = await ctx.places.search(query, limit ?? 5)
        return text(formatPlaceSearch(query, result, msgs))
      } catch (error) {
        return toolError(error, msgs)
      }
    },
  )
}
