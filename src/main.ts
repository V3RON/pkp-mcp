import { rmSync } from 'node:fs'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createApp } from './app.ts'
import { runStatus } from './cli/status.ts'
import { loadConfig } from './config.ts'
import { log } from './log.ts'
import { createServer, SERVER_VERSION } from './server.ts'

const HELP = `pkp-mcp ${SERVER_VERSION} — MCP server for Polish train timetables (PKP PLK open data)

Usage:
  pkp-mcp                  start the MCP server on stdio (used by Claude Code / Codex)
  pkp-mcp status [--remote] show cache, language and request usage (--remote asks the API about the key)
  pkp-mcp clear-cache      delete the local cache
  pkp-mcp --help | --version

Environment:
  PKP_API_KEY         API key from https://pdp-api.plk-sa.pl/ (required for data)
  PKP_MCP_LANG        output language override: pl | en
  PKP_MCP_CACHE_DIR   cache directory override
  PKP_MCP_LOG=debug   verbose logging to stderr`

export async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv
  const config = loadConfig()

  switch (command) {
    case undefined:
      return serve(config)
    case 'status': {
      const app = createApp(config)
      process.stdout.write(`${await runStatus(app, rest.includes('--remote'))}\n`)
      return
    }
    case 'clear-cache':
      rmSync(config.cacheDir, { recursive: true, force: true })
      process.stdout.write(`Removed ${config.cacheDir}\n`)
      return
    case '--version':
    case '-v':
      process.stdout.write(`${SERVER_VERSION}\n`)
      return
    case '--help':
    case '-h':
    case 'help':
      process.stdout.write(`${HELP}\n`)
      return
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${HELP}\n`)
      process.exitCode = 2
  }
}

async function serve(config: ReturnType<typeof loadConfig>): Promise<void> {
  const app = createApp(config)
  if (!config.apiKey) log.warn('PKP_API_KEY is not set; tools will explain how to get a key')
  const server = createServer(app)
  await server.connect(new StdioServerTransport())
  log.info('ready')
  // Resolve the language in the background so the first tool call doesn't wait for it.
  void app.locale.base().then((locale) => log.debug('language', locale))
}
