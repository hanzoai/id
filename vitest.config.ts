import { defineConfig } from 'vitest/config'

// Single test runner for the whole monorepo. Every `*.test.ts` under any
// package's `src/` runs here — the connect crypto/connector suites (vitest
// describe/it/expect) and the auth / shared / onboarding suites (bare
// `test()` + node:assert). One config, one `pnpm test`, one way.
export default defineConfig({
  test: {
    include: ['pkgs/**/src/**/*.test.ts'],
    environment: 'node',
  },
})
