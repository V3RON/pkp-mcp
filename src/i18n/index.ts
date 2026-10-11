import { en, type Messages } from './en.ts'
import { pl } from './pl.ts'

export type Lang = 'en' | 'pl'
export type { Messages }

const TABLES: Record<Lang, Messages> = { en, pl }

export function messages(lang: Lang): Messages {
  return TABLES[lang]
}

export interface LocaleSource {
  lang: Lang
  /** Where the language came from, shown by `pkp-mcp status`. */
  source: string
}

/** Everything detection looks at, gathered by ./sources.ts so this stays pure and testable. */
export interface LocaleInputs {
  override: string | undefined
  /** Claude Code's free-text `language` setting ("polish", "English"…), when running under Claude Code. */
  claudeLanguage: string | undefined
  env: Record<string, string | undefined>
  platform: NodeJS.Platform
  /** What Node's ICU reports. Only trusted on Windows: on POSIX it merely mirrors the env vars. */
  intlLocale: string | undefined
  /** macOS UI language list (`defaults read -g AppleLanguages`), most preferred first. */
  macLanguages: string[] | undefined
}

/**
 * Process-level language, first match wins:
 *   PKP_MCP_LANG → Claude Code `language` setting → LANGUAGE/LC_ALL/LC_MESSAGES/LANG
 *   → Windows user locale (Intl) → macOS AppleLanguages → English.
 * A per-request Accept-Language from the client (see `fromAcceptLanguage`) beats everything but PKP_MCP_LANG.
 */
export function detectLang(inputs: LocaleInputs): LocaleSource {
  const override = inputs.override && toLang(inputs.override)
  if (override) return { lang: override, source: 'PKP_MCP_LANG' }

  const claude = inputs.claudeLanguage && toLang(inputs.claudeLanguage)
  if (claude) return { lang: claude, source: 'Claude Code language setting' }

  const posix = posixLocale(inputs.env)
  if (posix) return { lang: toLang(posix.value) ?? 'en', source: posix.name }

  if (inputs.platform === 'win32' && isMeaningful(inputs.intlLocale)) {
    return { lang: toLang(inputs.intlLocale) ?? 'en', source: 'Windows locale' }
  }
  const mac = inputs.macLanguages?.[0]
  if (mac) return { lang: toLang(mac) ?? 'en', source: 'macOS language' }
  return { lang: 'en', source: 'default' }
}

/**
 * POSIX/gettext precedence for message language. LANGUAGE (a priority list like "pl:en") only
 * counts when a real locale is set, as in gettext; the first entry decides.
 */
function posixLocale(env: Record<string, string | undefined>): { name: string; value: string } | undefined {
  for (const name of ['LC_ALL', 'LC_MESSAGES', 'LANG'] as const) {
    const value = env[name]
    if (!isMeaningful(value)) continue
    const preferred = env.LANGUAGE?.split(':').find((entry) => entry.trim() !== '')
    return preferred ? { name: 'LANGUAGE', value: preferred } : { name, value }
  }
  return undefined
}

/**
 * Client-provided preference in Accept-Language syntax ("pl-PL,pl;q=0.9,en;q=0.8"), as proposed by
 * MCP SEP-2792 (`_meta["io.modelcontextprotocol/acceptLanguage"]`). Highest-q supported language wins.
 */
export function fromAcceptLanguage(header: string): Lang | undefined {
  const ranges = header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';')
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.slice(2)) : 1, index }
    })
    .filter((r) => r.tag && r.tag !== '*' && Number.isFinite(r.q) && r.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
  for (const { tag } of ranges) {
    if (tag === 'pl' || tag.startsWith('pl-')) return 'pl'
    if (tag === 'en' || tag.startsWith('en-')) return 'en'
  }
  return ranges.length > 0 ? 'en' : undefined
}

export function isMeaningful(value: string | undefined): value is string {
  if (!value) return false
  const base = value.split(/[.@]/)[0]?.toUpperCase()
  return base !== '' && base !== 'C' && base !== 'POSIX'
}

/** "pl_PL.UTF-8", "pl-PL", "pl", "Polish", "polski" → "pl"; any other recognisable value → "en". */
export function toLang(value: string): Lang | undefined {
  const lower = value.trim().toLowerCase()
  if (!lower) return undefined
  if (/^pl([-_.@]|$)/.test(lower) || /^(polish|polski)/.test(lower)) return 'pl'
  return 'en'
}
