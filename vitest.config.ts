import { defineConfig } from 'vitest/config'

// Single test runner for the whole monorepo. Every `*.test.ts` and `*.test.tsx`
// under any package's `src/` runs here — the connect crypto/connector suites
// (vitest describe/it/expect), the auth / shared / onboarding suites (bare
// `test()` + node:assert), and the component suites that mount a form and read the
// DOM. One config, one `pnpm test`, one way.
//
// A DOM for everything, rather than per-file annotations. The login surface's whole
// claim is WHICH sign-in method renders WHEN, and that was unverifiable: no .tsx
// pattern was collected and the environment had no document, so the one page-level
// test read Login.tsx as TEXT and matched regexes against it — green with the
// component fully broken, red on an innocuous rename. Everything else here is
// pure and does not care that a window exists.
export default defineConfig({
  test: {
    include: ['pkgs/**/src/**/*.test.ts', 'pkgs/**/src/**/*.test.tsx', 'apps/**/src/**/*.test.ts', 'apps/**/src/**/*.test.tsx'],
    environment: 'happy-dom',
  },
})
