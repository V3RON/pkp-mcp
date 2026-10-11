import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultCacheDir, loadConfig } from '../src/config.ts'

describe('config', () => {
  it('uses the per-OS user cache directory', () => {
    expect(defaultCacheDir({}, 'linux', '/home/u')).toBe(join('/home/u', '.cache', 'pkp-mcp'))
    expect(defaultCacheDir({ XDG_CACHE_HOME: '/x' }, 'linux', '/home/u')).toBe(join('/x', 'pkp-mcp'))
    expect(defaultCacheDir({}, 'darwin', '/Users/u')).toBe(join('/Users/u', 'Library', 'Caches', 'pkp-mcp'))
    expect(defaultCacheDir({ LOCALAPPDATA: 'C:\\L' }, 'win32', 'C:\\U')).toBe(
      join('C:\\L', 'pkp-mcp', 'Cache'),
    )
  })

  it('treats blank values as unset and trims the base URL', () => {
    const config = loadConfig({
      PKP_API_KEY: '  ',
      PKP_API_BASE_URL: 'https://example.test///',
      PKP_MCP_CACHE_DIR: '/c',
    })
    expect(config.apiKey).toBeUndefined()
    expect(config.baseUrl).toBe('https://example.test')
    expect(config.cacheDir).toBe('/c')
  })
})
