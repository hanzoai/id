/**
 * Workaround for @cloudflare/next-on-pages + Next.js 15
 *
 * Next.js 15 generates /_not-found as a Node.js function even when
 * the root layout exports `runtime = 'edge'`. This script removes
 * the _not-found function and its route from the Vercel build output
 * so next-on-pages can proceed. The middleware handles 404s anyway.
 */

import { rmSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const outDir = join(process.cwd(), '.vercel', 'output')
const funcDir = join(outDir, 'functions')

// Remove _not-found function directories
for (const name of ['_not-found.func', '_not-found.rsc.func']) {
  try {
    rmSync(join(funcDir, name), { recursive: true, force: true })
    console.log(`Removed ${name}`)
  } catch {}
}

// Remove _not-found route from config.json
const configPath = join(outDir, 'config.json')
const config = JSON.parse(readFileSync(configPath, 'utf8'))
config.routes = (config.routes || []).filter(
  (r) => !String(r.dest || '').includes('/_not-found')
)
writeFileSync(configPath, JSON.stringify(config, null, 2))
console.log('Patched config.json — removed _not-found routes')
