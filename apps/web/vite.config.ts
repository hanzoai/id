import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'path'
import { readFileSync, existsSync } from 'fs'
import { createRequire } from 'module'
import { localizeBrandJson, brandAssetType, type LocalizedBrand } from './src/brand-local'

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
 * Asset URLs inside each `brand.json` (logo, favicon) point at
 * `cdn.jsdelivr.net/npm/@<scope>/brand@latest/...` — a third-party request on
 * a floating tag, on the credential-entry path. `localizeBrandJson` rewrites
 * any such field to a flat same-origin `/brand/<slug>/<file>` whenever the
 * asset exists locally (in the installed package, or checked in under
 * `public/brand/<pkg>/` for packages that don't ship their assets), and this
 * plugin emits those files alongside the JSON. A URL with no local file stays
 * verbatim, so a missing asset degrades exactly as before (wordmark fallback).
 */
const BRAND_PACKAGES = ['@hanzo/brand', '@luxfi/brand', '@zooai/brand', '@parsdao/brand']

/** npm scope -> flat brand slug: `@hanzo/brand` -> `hanzo`. */
const brandSlug = (pkg: string): string => pkg.replace(/^@/, '').split('/')[0]!

/** Read + localize one brand package's JSON. Null when the pkg isn't installed. */
function localizedBrand(pkg: string): LocalizedBrand | null {
  let jsonPath: string
  try {
    jsonPath = req.resolve(`${pkg}/brand.json`)
  } catch {
    return null
  }
  if (!existsSync(jsonPath)) return null
  const pkgDir = dirname(jsonPath)
  const publicDir = resolve(__dirname, 'public/brand', pkg)
  const resolveLocal = (rel: string): string | null => {
    for (const base of [pkgDir, publicDir]) {
      const p = resolve(base, rel)
      if (existsSync(p)) return p
    }
    return null
  }
  return localizeBrandJson(readFileSync(jsonPath, 'utf8'), pkg, brandSlug(pkg), resolveLocal)
}

function brandJsonPlugin() {
  return {
    name: 'hanzo-id-brand-json',
    configureServer(server: any) {
      server.middlewares.use((req2: any, res: any, next: any) => {
        // Localized JSON: /brand/<slug>.json
        const mj = /^\/brand\/([^/]+)\.json$/.exec(req2.url ?? '')
        // Localized asset: /brand/<slug>/<file> (flat file, no nesting)
        const ma = /^\/brand\/([^/]+)\/([^/?#]+)$/.exec(req2.url ?? '')
        const slug = mj?.[1] ?? ma?.[1]
        if (!slug) return next()
        const pkg = BRAND_PACKAGES.find((p) => brandSlug(p) === slug)
        const local = pkg ? localizedBrand(pkg) : null
        if (!local) {
          res.statusCode = 404
          return res.end()
        }
        res.setHeader('Cache-Control', 'no-store')
        if (mj) {
          res.setHeader('Content-Type', 'application/json')
          return res.end(local.json)
        }
        const fileName = `brand/${slug}/${ma![2]!}`
        const src = local.assets.get(fileName)
        if (!src) {
          res.statusCode = 404
          return res.end()
        }
        res.setHeader('Content-Type', brandAssetType(fileName))
        return res.end(readFileSync(src))
      })
    },
    generateBundle(this: any) {
      for (const pkg of BRAND_PACKAGES) {
        const local = localizedBrand(pkg)
        if (!local) continue // pkg not installed — only declared brands ship
        this.emitFile({ type: 'asset', fileName: `brand/${brandSlug(pkg)}.json`, source: local.json })
        for (const [fileName, src] of local.assets) {
          this.emitFile({ type: 'asset', fileName, source: readFileSync(src) })
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
