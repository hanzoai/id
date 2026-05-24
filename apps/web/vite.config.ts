import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve, dirname, join, relative } from 'path'
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require_ = createRequire(import.meta.url)

/**
 * Per-brand asset serving plugin.
 *
 * Each per-org brand package (`@hanzo/brand`, `@luxfi/brand`,
 * `@zooai/brand`, `@parsdao/brand`) ships a `brand.json` at the package
 * root and an `assets/` directory with logos / favicons. The runtime
 * fetches `/brand/<pkg>/brand.json` to discover the right brand, then
 * pulls any referenced asset from `/brand/<pkg>/assets/...`.
 *
 * In dev: middleware proxies the requests to the resolved package path.
 * In build: every `brand.json` + every file under `assets/` is emitted as
 * a static asset. The JS bundle still tree-shakes — only the brand
 * packages listed below need to be installed.
 */
const BRAND_PACKAGES = ['@hanzo/brand', '@luxfi/brand', '@zooai/brand', '@parsdao/brand']

function resolveBrandPkgDir(pkg: string): string | null {
  try {
    const jsonPath = require_.resolve(`${pkg}/brand.json`, { paths: [__dirname] })
    return dirname(jsonPath)
  } catch {
    for (const root of [__dirname, join(__dirname, '..', '..'), join(__dirname, '..', '..', '..')]) {
      const guess = join(root, 'node_modules', pkg)
      if (existsSync(join(guess, 'brand.json'))) return guess
    }
    return null
  }
}

function listFilesRecursive(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...listFilesRecursive(full))
    else if (st.isFile()) out.push(full)
  }
  return out
}

function brandJsonPlugin() {
  return {
    name: 'id-portal-brand',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        const m = /^\/brand\/([^/]+\/[^/]+)\/(.+)$/.exec(req.url ?? '')
        if (!m) return next()
        const pkg = decodeURIComponent(m[1]!)
        const sub = m[2]!
        if (!BRAND_PACKAGES.includes(pkg)) {
          res.statusCode = 404
          return res.end()
        }
        const pkgDir = resolveBrandPkgDir(pkg)
        if (!pkgDir) {
          res.statusCode = 404
          return res.end()
        }
        const filePath = join(pkgDir, sub)
        if (!filePath.startsWith(pkgDir) || !existsSync(filePath)) {
          res.statusCode = 404
          return res.end()
        }
        const ext = sub.split('.').pop()!.toLowerCase()
        const ctype = ({
          json: 'application/json',
          svg: 'image/svg+xml',
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          webp: 'image/webp',
          ico: 'image/x-icon',
          woff: 'font/woff',
          woff2: 'font/woff2',
          css: 'text/css',
        } as Record<string, string>)[ext] ?? 'application/octet-stream'
        res.setHeader('Content-Type', ctype)
        res.setHeader('Cache-Control', 'no-store')
        return res.end(readFileSync(filePath))
      })
    },
    generateBundle(this: any) {
      for (const pkg of BRAND_PACKAGES) {
        const pkgDir = resolveBrandPkgDir(pkg)
        if (!pkgDir) {
          this.warn(`brand pkg not found at build time: ${pkg}`)
          continue
        }
        const bjson = join(pkgDir, 'brand.json')
        if (existsSync(bjson)) {
          this.emitFile({
            type: 'asset',
            fileName: `brand/${pkg}/brand.json`,
            source: readFileSync(bjson, 'utf8'),
          })
        }
        const assetsDir = join(pkgDir, 'assets')
        if (existsSync(assetsDir)) {
          for (const file of listFilesRecursive(assetsDir)) {
            const rel = relative(pkgDir, file)
            this.emitFile({
              type: 'asset',
              fileName: `brand/${pkg}/${rel}`,
              source: readFileSync(file),
            })
          }
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
  server: { port: 5173, host: '0.0.0.0' },
  preview: { port: 5174, host: '0.0.0.0' },
  build: { target: 'es2022', sourcemap: true },
})
