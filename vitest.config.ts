import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Only show console output (our stderr logs) for failing tests.
    silent: 'passed-only',
    // node:sqlite is still flagged experimental on Node 22.
    execArgv: ['--disable-warning=ExperimentalWarning'],
  },
})
