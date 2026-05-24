import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve, dirname, join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require_ = createRequire(import.meta.url)

/**
 * Per-brand brand.json serving plugin.
 *
 * Each per-org brand package ships a `brand.json` at the package root.
 * We resolve each via Node's resolver, serve verbatim in dev, and emit
 * them as static assets at build time so the runtime can fetch them
 * at `/brand/<pkg>/brand.json`. No bundle bloat — the unused brand
 * packages still tree-shake away from the JS.
 */
const BRAND_PACKAGES = ['@hanzo/brand', '@luxfi/brand', '@zooai/brand', '@parsdao/brand']

function resolveBrandJson(pkg: string): string | null {
  try {
    return require_.resolve(`${pkg}/brand.json`, { paths: [__dirname] })
  } catch {
    // Fall back to walking node_modules from the workspace root.
    for (const root of [__dirname, join(__dirname, '..', '..'), join(__dirname, '..', '..', '..')]) {
      const guess = join(root, 'node_modules', pkg, 'brand.json')
      if (existsSync(guess)) return guess
    }
    return null
  }
}

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
        const path = resolveBrandJson(pkg)
        if (!path) {
          res.statusCode = 404
          return res.end()
        }
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        return res.end(readFileSync(path, 'utf8'))
      })
    },
    generateBundle(this: any) {
      for (const pkg of BRAND_PACKAGES) {
        const path = resolveBrandJson(pkg)
        if (!path) {
          this.warn(`brand pkg not found at build time: ${pkg}`)
          continue
        }
        this.emitFile({
          type: 'asset',
          fileName: `brand/${pkg}/brand.json`,
          source: readFileSync(path, 'utf8'),
        })
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), brandJsonPlugin()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  server: { port: 5173, host: '0.0.0.0' },
  preview: { port: 5174, host: '0.0.0.0' },
  build: { target: 'es2022', sourcemap: true },
})
