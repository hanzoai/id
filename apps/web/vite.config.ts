import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync, existsSync } from 'fs'

/**
 * Per-brand brand.json copy plugin.
 *
 * Each per-org brand package (`@hanzo/brand`, `@luxfi/brand`, `@zooai/brand`,
 * `@parsdao/brand`) ships a `brand.json` at the package root. We serve them
 * verbatim at `/brand/<pkg>/brand.json` so the runtime tenant resolver can
 * fetch the right one based on hostname.
 *
 * Assets (logos, favicons) are imported by URL inside the per-brand `brand.json`
 * (CDN URLs in production), so no further asset copying is needed.
 */
const BRAND_PACKAGES = ['@hanzo/brand', '@luxfi/brand', '@zooai/brand', '@parsdao/brand']

function brandJsonPlugin() {
  return {
    name: 'hanzo-id-brand-json',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        const m = /^\/brand\/(.+)\/brand\.json$/.exec(req.url ?? '')
        if (!m) return next()
        const pkg = decodeURIComponent(m[1]!)
        if (!BRAND_PACKAGES.includes(pkg)) {
          res.statusCode = 404
          return res.end()
        }
        try {
          const path = require.resolve(`${pkg}/brand.json`)
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
          const path = require.resolve(`${pkg}/brand.json`)
          if (!existsSync(path)) continue
          this.emitFile({
            type: 'asset',
            fileName: `brand/${pkg}/brand.json`,
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
