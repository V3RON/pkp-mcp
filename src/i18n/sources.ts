import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { log } from '../log.ts'
import { isMeaningful, type LocaleInputs } from './index.ts'

type Env = Record<string, string | undefined>

export interface SourceDeps {
  readFile: (path: string) => Promise<string>
  /** Runs a command and resolves stdout, or rejects on failure/timeout. */
  exec: (command: string, args: string[]) => Promise<string>
  home: string
}

const defaultDeps: SourceDeps = {
  readFile: (path) => readFile(path, 'utf8'),
  exec: (command, args) =>
    new Promise((resolve, reject) => {
      execFile(command, args, { timeout: 1500, windowsHide: true }, (error, stdout) =>
        error ? reject(error) : resolve(stdout),
      )
    }),
  home: homedir(),
}

/** Collects every locale signal. The only process spawn (macOS `defaults`) happens when env vars say nothing. */
export async function gatherLocaleInputs(
  env: Env,
  override: string | undefined,
  platform: NodeJS.Platform = process.platform,
  deps: SourceDeps = defaultDeps,
): Promise<LocaleInputs> {
  const inputs: LocaleInputs = {
    override,
    claudeLanguage: env.CLAUDECODE === '1' ? await readClaudeLanguage(env, deps) : undefined,
    env,
    platform,
    intlLocale: Intl.DateTimeFormat().resolvedOptions().locale,
    macLanguages: undefined,
  }
  const hasPosixLocale = ['LC_ALL', 'LC_MESSAGES', 'LANG'].some((name) => isMeaningful(env[name]))
  if (platform === 'darwin' && !override && !inputs.claudeLanguage && !hasPosixLocale) {
    inputs.macLanguages = await readMacLanguages(deps)
  }
  return inputs
}

/**
 * Claude Code's `language` setting (free text meant for the model, e.g. "polish"). Not an official
 * MCP channel, so best effort: settings files in Claude Code's precedence order, local project first.
 */
export async function readClaudeLanguage(env: Env, deps: SourceDeps): Promise<string | undefined> {
  const configDir = env.CLAUDE_CONFIG_DIR || join(deps.home, '.claude')
  const projectDir = env.CLAUDE_PROJECT_DIR
  const files = [
    ...(projectDir
      ? [join(projectDir, '.claude', 'settings.local.json'), join(projectDir, '.claude', 'settings.json')]
      : []),
    join(configDir, 'settings.json'),
  ]
  for (const file of files) {
    try {
      const settings = JSON.parse(await deps.readFile(file)) as { language?: unknown }
      if (typeof settings.language === 'string' && settings.language.trim()) return settings.language
    } catch {
      // Missing or unparsable file: try the next one.
    }
  }
  return undefined
}

/** macOS UI languages. GUI-launched apps often have no LANG, so this is the reliable fallback there. */
export async function readMacLanguages(deps: SourceDeps): Promise<string[] | undefined> {
  try {
    const languages = parsePlistStrings(await deps.exec('defaults', ['read', '-g', 'AppleLanguages']))
    if (languages.length > 0) return languages
  } catch (error) {
    log.debug('AppleLanguages unavailable', error)
  }
  try {
    const locale = (await deps.exec('defaults', ['read', '-g', 'AppleLocale'])).trim()
    return locale ? [locale] : undefined
  } catch (error) {
    log.debug('AppleLocale unavailable', error)
    return undefined
  }
}

/** `defaults` prints an old-style plist array: (\n    "pl-PL",\n    en\n). */
export function parsePlistStrings(output: string): string[] {
  const body = output.trim().replace(/^\(/, '').replace(/\)$/, '')
  return body
    .split(',')
    .map((item) => item.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean)
}
