import { describe, expect, it } from 'vitest'
import { en } from '../src/i18n/en.ts'
import { detectLang, fromAcceptLanguage, type LocaleInputs, toLang } from '../src/i18n/index.ts'
import { pl } from '../src/i18n/pl.ts'
import { ACCEPT_LANGUAGE_META, LocaleResolver } from '../src/i18n/resolver.ts'
import { gatherLocaleInputs, parsePlistStrings, type SourceDeps } from '../src/i18n/sources.ts'

describe('message tables', () => {
  it('have the same keys in every language', () => {
    expect(Object.keys(pl).sort()).toEqual(Object.keys(en).sort())
  })

  it('use Polish plural forms', () => {
    expect([1, 2, 4, 5, 12, 14, 22, 25, 112].map(pl.stationsCount)).toEqual([
      '1 stacja',
      '2 stacje',
      '4 stacje',
      '5 stacji',
      '12 stacji',
      '14 stacji',
      '22 stacje',
      '25 stacji',
      '112 stacji',
    ])
  })
})

const none: LocaleInputs = {
  override: undefined,
  claudeLanguage: undefined,
  env: {},
  platform: 'linux',
  intlLocale: 'en-US',
  macLanguages: undefined,
}

describe('detectLang', () => {
  it('prefers PKP_MCP_LANG, then the Claude Code setting, then env vars', () => {
    const env = { LANG: 'en_US.UTF-8' }
    expect(detectLang({ ...none, env, override: 'pl', claudeLanguage: 'english' })).toEqual({
      lang: 'pl',
      source: 'PKP_MCP_LANG',
    })
    expect(detectLang({ ...none, env, claudeLanguage: 'Polish' })).toEqual({
      lang: 'pl',
      source: 'Claude Code language setting',
    })
    expect(detectLang({ ...none, env })).toEqual({ lang: 'en', source: 'LANG' })
  })

  it('follows POSIX precedence, with LANGUAGE only when a real locale is set', () => {
    expect(detectLang({ ...none, env: { LC_ALL: 'pl_PL.UTF-8', LANG: 'en_US.UTF-8' } }).lang).toBe('pl')
    expect(detectLang({ ...none, env: { LC_MESSAGES: 'en_GB.UTF-8', LANG: 'pl_PL.UTF-8' } }).lang).toBe('en')
    expect(detectLang({ ...none, env: { LANG: 'en_US.UTF-8', LANGUAGE: 'pl:en' } })).toEqual({
      lang: 'pl',
      source: 'LANGUAGE',
    })
    expect(detectLang({ ...none, env: { LANG: 'C.UTF-8', LANGUAGE: 'pl' } })).toEqual({
      lang: 'en',
      source: 'default',
    })
  })

  it('ignores Intl on POSIX, where it only mirrors env vars and defaults to en-US', () => {
    expect(detectLang({ ...none, intlLocale: 'pl-PL' })).toEqual({ lang: 'en', source: 'default' })
  })

  it('uses the Windows user locale from Intl', () => {
    expect(detectLang({ ...none, platform: 'win32', intlLocale: 'pl-PL' })).toEqual({
      lang: 'pl',
      source: 'Windows locale',
    })
  })

  it('falls back to the macOS language list when no env locale is set', () => {
    expect(detectLang({ ...none, platform: 'darwin', macLanguages: ['pl-PL', 'en-US'] })).toEqual({
      lang: 'pl',
      source: 'macOS language',
    })
  })

  it('maps locale spellings', () => {
    expect(['pl', 'pl-PL', 'pl_PL.UTF-8', 'Polish', 'polski'].map(toLang)).toEqual([
      'pl',
      'pl',
      'pl',
      'pl',
      'pl',
    ])
    expect(['de_DE', 'en', 'plk', 'japanese'].map(toLang)).toEqual(['en', 'en', 'en', 'en'])
  })
})

describe('fromAcceptLanguage', () => {
  it('picks the highest-weighted supported language', () => {
    expect(fromAcceptLanguage('pl-PL,pl;q=0.9,en;q=0.8')).toBe('pl')
    expect(fromAcceptLanguage('de;q=1, en;q=0.5, pl;q=0.7')).toBe('pl')
    expect(fromAcceptLanguage('en-GB')).toBe('en')
    expect(fromAcceptLanguage('de')).toBe('en')
    expect(fromAcceptLanguage('')).toBeUndefined()
  })
})

function deps(files: Record<string, string>, commands: Record<string, string> = {}) {
  const ran: string[] = []
  const d: SourceDeps = {
    home: '/home/u',
    readFile: async (path) => {
      const content = files[path]
      if (content === undefined) throw new Error('ENOENT')
      return content
    },
    exec: async (command, args) => {
      const key = [command, ...args].join(' ')
      ran.push(key)
      const out = commands[key]
      if (out === undefined) throw new Error('not found')
      return out
    },
  }
  return { d, ran }
}

describe('gatherLocaleInputs', () => {
  it('reads Claude Code settings only under Claude Code, local project file first', async () => {
    const files = {
      '/proj/.claude/settings.local.json': '{"language":"polish"}',
      '/home/u/.claude/settings.json': '{"language":"english"}',
    }
    const env = { CLAUDECODE: '1', CLAUDE_PROJECT_DIR: '/proj' }
    expect((await gatherLocaleInputs(env, undefined, 'linux', deps(files).d)).claudeLanguage).toBe('polish')
    expect(
      (await gatherLocaleInputs({ CLAUDECODE: '1' }, undefined, 'linux', deps(files).d)).claudeLanguage,
    ).toBe('english')
    expect((await gatherLocaleInputs({}, undefined, 'linux', deps(files).d)).claudeLanguage).toBeUndefined()
  })

  it('honours CLAUDE_CONFIG_DIR and skips broken settings files', async () => {
    const files = { '/cfg/settings.json': '{"language":"Polski"}', '/proj/.claude/settings.json': '{oops' }
    const env = { CLAUDECODE: '1', CLAUDE_CONFIG_DIR: '/cfg', CLAUDE_PROJECT_DIR: '/proj' }
    expect((await gatherLocaleInputs(env, undefined, 'linux', deps(files).d)).claudeLanguage).toBe('Polski')
  })

  it('asks macOS for AppleLanguages only when nothing cheaper is available', async () => {
    const commands = { 'defaults read -g AppleLanguages': '(\n    "pl-PL",\n    "en-US"\n)\n' }
    const withoutLang = deps({}, commands)
    expect((await gatherLocaleInputs({}, undefined, 'darwin', withoutLang.d)).macLanguages).toEqual([
      'pl-PL',
      'en-US',
    ])

    const withLang = deps({}, commands)
    await gatherLocaleInputs({ LANG: 'en_US.UTF-8' }, undefined, 'darwin', withLang.d)
    expect(withLang.ran).toEqual([])
  })

  it('falls back to AppleLocale', async () => {
    const { d } = deps({}, { 'defaults read -g AppleLocale': 'pl_PL\n' })
    expect((await gatherLocaleInputs({}, undefined, 'darwin', d)).macLanguages).toEqual(['pl_PL'])
  })
})

describe('parsePlistStrings', () => {
  it('handles quoted and bare entries', () => {
    expect(parsePlistStrings('(\n    "pl-PL",\n    en\n)')).toEqual(['pl-PL', 'en'])
    expect(parsePlistStrings('()')).toEqual([])
  })
})

describe('LocaleResolver', () => {
  it('lets a per-request Accept-Language override the detected language', async () => {
    const resolver = new LocaleResolver({ LANG: 'en_US.UTF-8' }, undefined, 'linux', deps({}).d)
    expect(await resolver.forRequest(undefined)).toBe('en')
    expect(await resolver.forRequest({ [ACCEPT_LANGUAGE_META]: 'pl-PL,pl;q=0.9' })).toBe('pl')
  })

  it('keeps PKP_MCP_LANG above per-request preferences', async () => {
    const resolver = new LocaleResolver({}, 'en', 'linux', deps({}).d)
    expect(await resolver.forRequest({ [ACCEPT_LANGUAGE_META]: 'pl' })).toBe('en')
  })
})
