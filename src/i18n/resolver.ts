import {
  detectLang,
  fromAcceptLanguage,
  type Lang,
  type LocaleSource,
  type Messages,
  messages,
} from './index.ts'
import { gatherLocaleInputs, type SourceDeps } from './sources.ts'

export const ACCEPT_LANGUAGE_META = 'io.modelcontextprotocol/acceptLanguage'

/**
 * Resolves the output language once per process (lazily, so a slow `defaults` call never delays
 * startup), and lets a per-request Accept-Language from the client refine it.
 */
export class LocaleResolver {
  private readonly env: Record<string, string | undefined>
  private readonly override: string | undefined
  private readonly platform: NodeJS.Platform
  private readonly deps: SourceDeps | undefined
  private detected: Promise<LocaleSource> | undefined

  constructor(
    env: Record<string, string | undefined>,
    override: string | undefined,
    platform: NodeJS.Platform = process.platform,
    deps?: SourceDeps,
  ) {
    this.env = env
    this.override = override
    this.platform = platform
    this.deps = deps
  }

  /** Process-level language (no request context). */
  base(): Promise<LocaleSource> {
    this.detected ??= gatherLocaleInputs(this.env, this.override, this.platform, this.deps)
      .then(detectLang)
      .catch(() => ({ lang: 'en' as Lang, source: 'default' }))
    return this.detected
  }

  /** Language for one tool call. PKP_MCP_LANG still wins: the user configured this server explicitly. */
  async forRequest(meta: Record<string, unknown> | undefined): Promise<Lang> {
    const base = await this.base()
    if (base.source === 'PKP_MCP_LANG') return base.lang
    const header = meta?.[ACCEPT_LANGUAGE_META]
    return (typeof header === 'string' && fromAcceptLanguage(header)) || base.lang
  }

  async messagesFor(meta: Record<string, unknown> | undefined): Promise<Messages> {
    return messages(await this.forRequest(meta))
  }
}
