/**
 * Every token this surface references must RESOLVE.
 *
 * An undefined CSS custom property paints nothing and reports no error, so this
 * whole class of defect survives review: `var(--surface-1)` and
 * `var(--shadow-lg)` shipped in @hanzo/iam's account menu against a token layer
 * that defines neither, and the menu rendered transparent. "It is declared" was
 * never evidence — nor was "it type-checks", because the reference is built at
 * runtime from a string and is invisible to both the compiler and grep.
 *
 * So the gate is resolution, and it is computed from what the bundle ACTUALLY
 * serves: it walks app.css's @import graph into the installed @hanzo/design,
 * collects the tokens those files declare, then asserts that every var(--x)
 * anywhere under src/ — plus every token @hanzo/iam paints its menu with — is
 * in that set.
 *
 * This fails if someone cherry-picks token groups again (the four-of-nine
 * subset this file used to import left --z-*, --shadow-* and --space-* out),
 * if @hanzo/design renames or drops a token, or if a component starts asking
 * for a token in @hanzo/brand's vocabulary instead of @hanzo/design's.
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.join(import.meta.dirname, '.')

/**
 * Both packages restrict `exports`, so resolve them by walking up for the
 * node_modules directory rather than by asking Node for a subpath it refuses.
 */
function pkgRoot(name: string): string {
  for (let d = SRC; d !== path.dirname(d); d = path.dirname(d)) {
    const p = path.join(d, 'node_modules', name)
    if (fs.existsSync(path.join(p, 'package.json'))) return fs.realpathSync(p)
  }
  throw new Error(`${name} is not installed`)
}
const DESIGN = pkgRoot('@hanzo/design')

const read = (p: string) => fs.readFileSync(p, 'utf8')
const declaredIn = (css: string) => [...css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1])
const referencedIn = (css: string) => [...css.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map((m) => m[1])

/** Follow @import from an entry stylesheet into the @hanzo/design package. */
function tokenFiles(entry: string, seen = new Set<string>()): string[] {
  for (const m of read(entry).matchAll(/@import\s+(?:url\()?['"]([^'"]+)['"]/g)) {
    const spec = m[1]
    const abs = spec.startsWith('@hanzo/design/')
      ? path.join(DESIGN, spec.slice('@hanzo/design/'.length))
      : path.resolve(path.dirname(entry), spec)
    if (seen.has(abs) || !fs.existsSync(abs)) continue
    seen.add(abs)
    tokenFiles(abs, seen)
  }
  return [...seen]
}

/** Every .css/.ts/.tsx under src/, so inline `var(--x)` in a component counts. */
function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) sources(p, out)
    // Skip this file: its own doc comment quotes `var(--x)`.
    else if (/\.(css|tsx?)$/.test(e.name) && p !== import.meta.filename) out.push(p)
  }
  return out
}

const served = tokenFiles(path.join(SRC, 'app.css'))
const available = new Set(served.flatMap((f) => declaredIn(read(f))))
const files = sources(SRC)
const local = new Set(files.flatMap((f) => declaredIn(read(f))))

test('app.css serves the whole @hanzo/design token layer, not a subset', () => {
  const groups = fs.readdirSync(path.join(DESIGN, 'tokens')).filter((f) => f.endsWith('.css'))
  const missing = groups.filter((g) => !served.some((s) => s.endsWith(path.join('tokens', g))))
  assert.deepEqual(missing, [], `token groups authored by @hanzo/design but never served here: ${missing.join(', ')}`)
})

test('every token this surface references is defined', () => {
  const unresolved = new Map<string, string[]>()
  for (const f of files) {
    for (const name of referencedIn(read(f))) {
      if (available.has(name) || local.has(name)) continue
      const at = unresolved.get(name) ?? []
      at.push(path.relative(SRC, f))
      unresolved.set(name, at)
    }
  }
  assert.deepEqual(
    [...unresolved].map(([n, at]) => `${n} (${[...new Set(at)].join(', ')})`),
    [],
  )
})

test('every token @hanzo/iam paints the account menu with is defined', () => {
  // The menu is a distributed component: it emits its own stylesheet at
  // runtime, so its token references never appear in this repo's source and no
  // amount of grepping here would find them. Read them out of the shipped
  // bundle instead — literal `var(--x)` plus the names its tok() helper builds.
  const iam = read(path.join(pkgRoot('@hanzo/iam'), 'dist/react.js'))
  const names = new Set([
    ...referencedIn(iam),
    ...[...iam.matchAll(/\btok\(\s*["']([a-zA-Z0-9-]+)["']/g)].map((m) => `--${m[1]}`),
  ])
  const unresolved = [...names].filter((n) => !available.has(n)).sort()
  assert.deepEqual(unresolved, [])
})
