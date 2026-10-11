#!/usr/bin/env node
// node:sqlite prints an ExperimentalWarning on Node 22. Filter that one warning before the module
// graph that loads it is imported (hence the dynamic import below); everything else passes through.
const emitWarning = process.emitWarning.bind(process)
process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  const message = typeof warning === 'string' ? warning : warning.message
  if (message.includes('SQLite is an experimental feature')) return
  return (emitWarning as (...a: unknown[]) => void)(warning, ...args)
}) as typeof process.emitWarning

const { main } = await import('./main.ts')
const { redact } = await import('./log.ts')
await main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(redact(`[pkp-mcp] fatal ${error instanceof Error ? error.message : String(error)}\n`))
  process.exit(1)
})
