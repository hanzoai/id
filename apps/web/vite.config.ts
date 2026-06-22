import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync, existsSync } from 'fs'
import { createRequire } from 'module'

// ESM Vite config has no global `require`; build one bound to this file so
// `require.resolve('@scope/brand/brand.json')` works at config-eval time.
const req = createRequire(import.meta.url)

/**
 * Per-brand brand.json copy plugin.
 *
 * Each per-org brand package (`@hanzo/brand`, `@luxfi/brand`, `@zooai/brand`,
 * `@parsdao/brand`) ships a `brand.json` at the package root. We serve each at
 * a FLAT, encoding-safe path `/brand/<scope>.json` (scope = the npm scope:
 * `@hanzo/brand` -> `hanzo`). A nested `/brand/@hanzo/brand/brand.json` URL
 * carries a literal `@` and an encoded `%2F` that the production static server
 * (hanzoai/static) cannot map to the on-disk file — it falls through to the
 * SPA catch-all and returns index.html, so the runtime brand fetch would parse
 * HTML as JSON. The flat slug avoids that entirely. `loadBrand` fetches the
 * same `/brand/<scope>.json`.
 *
 * Assets (logos, favicons) are imported by URL inside the per-brand `brand.json`
 * (CDN URLs in production), so no further asset copying is needed.
 */
const BRAND_PACKAGES = ['@hanzo/brand', '@luxfi/brand', '@zooai/brand', '@parsdao/brand']

/** npm scope -> flat brand slug: `@hanzo/brand` -> `hanzo`. */
const brandSlug = (pkg: string): string => pkg.replace(/^@/, '').split('/')[0]!

function brandJsonPlugin() {
  return {
    name: 'hanzo-id-brand-json',
    configureServer(server: any) {
      server.middlewares.use((req2: any, res: any, next: any) => {
        const m = /^\/brand\/([^/]+)\.json$/.exec(req2.url ?? '')
        if (!m) return next()
        const slug = m[1]!
        const pkg = BRAND_PACKAGES.find((p) => brandSlug(p) === slug)
        if (!pkg) {
          res.statusCode = 404
          return res.end()
        }
        try {
          const path = req.resolve(`${pkg}/brand.json`)
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          return res.end(readFileSync(path, 'utf8'))
        } catch {
          res.statusCode = 404
          return res.end()
        }
      })
    },
    generateBundle(this: any) {
      for (const pkg of BRAND_PACKAGES) {
        try {
          const path = req.resolve(`${pkg}/brand.json`)
          if (!existsSync(path)) continue
          this.emitFile({
            type: 'asset',
            fileName: `brand/${brandSlug(pkg)}.json`,
            source: readFileSync(path, 'utf8'),
          })
        } catch {
          // pkg not installed — skip silently; only the brands listed in
          // package.json deps actually need their JSON shipped.
        }
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), brandJsonPlugin()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
  },
  preview: {
    port: 5174,
    host: '0.0.0.0',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})
