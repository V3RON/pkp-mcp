/**
 * stderr-only logger: stdout carries the MCP protocol. Every message passes through
 * `redact` so the API key can never reach a log, whatever the caller interpolates.
 */
const secrets = new Set<string>()
let debugEnabled = false

export function configureLog(options: { debug: boolean; secrets?: (string | undefined)[] }): void {
  debugEnabled = options.debug
  for (const secret of options.secrets ?? []) {
    if (secret && secret.length >= 4) secrets.add(secret)
  }
}

export function redact(text: string): string {
  let out = text
  for (const secret of secrets) out = out.split(secret).join('***')
  return out
}

function write(level: string, message: string, data?: unknown): void {
  const suffix = data === undefined ? '' : ` ${safeJson(data)}`
  process.stderr.write(`${redact(`[pkp-mcp] ${level} ${message}${suffix}`)}\n`)
}

function safeJson(data: unknown): string {
  try {
    return JSON.stringify(data instanceof Error ? { name: data.name, message: data.message } : data)
  } catch {
    return String(data)
  }
}

export const log = {
  debug: (message: string, data?: unknown) => {
    if (debugEnabled) write('debug', message, data)
  },
  info: (message: string, data?: unknown) => write('info', message, data),
  warn: (message: string, data?: unknown) => write('warn', message, data),
  error: (message: string, data?: unknown) => write('error', message, data),
}
