import { defineConfig } from '@playwright/test'

// The built export, driven in Chromium. Each spec answers the page's requests on
// its identity host from `dist/` — the bytes the site lane publishes — so
// `pnpm --filter @hanzo/id-web build` comes first.
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: true,
  reporter: 'list',
  use: { browserName: 'chromium' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 } } },
  ],
})
