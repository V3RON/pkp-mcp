import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_BASE_URL = 'https://pdp-api.plk-sa.pl'
export const SIGNUP_URL = 'https://pdp-api.plk-sa.pl/'

export interface Config {
  /** Undefined when PKP_API_KEY is not set; tools then answer with a sign-up hint instead of failing startup. */
  apiKey: string | undefined
  baseUrl: string
  cacheDir: string
  debug: boolean
}

type Env = Record<string, string | undefined>

export function loadConfig(env: Env = process.env, platform: NodeJS.Platform = process.platform): Config {
  return {
    apiKey: nonEmpty(env.PKP_API_KEY),
    baseUrl: (nonEmpty(env.PKP_API_BASE_URL) ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    cacheDir: nonEmpty(env.PKP_MCP_CACHE_DIR) ?? defaultCacheDir(env, platform),
    debug: env.PKP_MCP_LOG === 'debug',
  }
}

/** Per-OS user cache directory, so the cache survives restarts and is shared by every MCP client. */
export function defaultCacheDir(env: Env, platform: NodeJS.Platform, home: string = homedir()): string {
  if (platform === 'darwin') return join(home, 'Library', 'Caches', 'pkp-mcp')
  if (platform === 'win32') {
    const base = nonEmpty(env.LOCALAPPDATA) ?? join(home, 'AppData', 'Local')
    return join(base, 'pkp-mcp', 'Cache')
  }
  return join(nonEmpty(env.XDG_CACHE_HOME) ?? join(home, '.cache'), 'pkp-mcp')
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}
