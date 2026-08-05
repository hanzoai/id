/**
 * The telemetry gate, tested where it is actually true or false: on the bytes
 * the client puts on the wire.
 *
 * The defect this guards is not hypothetical and is not visible in review. The
 * obvious way to keep an OAuth code out of telemetry — "send the pathname, never
 * the href" — DOES NOT WORK against @hanzo/event, because `build()` stamps
 * `url: window.location.href` onto every event it assembles regardless of the
 * `path` the caller passed. A pageview from `/callback?code=…&state=…` therefore
 * ships the authorization code while `path` reads a clean `/callback`, and the
 * client's scrubber does not catch it: that scrubber redacts secret SHAPES
 * (JWT, sk-/pk-/hk-, bearer, cloud keys, PAN) and an opaque authorization code
 * is not one.
 *
 * So the gate is "do not emit from a route whose URL carries a credential", and
 * the test below asserts BOTH halves: that gated routes emit nothing, and that
 * the same setup ungated really does leak. The second half is what keeps this
 * from decaying into a decorative assertion — if @hanzo/event ever stops putting
 * the href on the wire, that case fails and this whole file can be revisited.
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createAnalytics } from '@hanzo/event'
import { telemetryAllowed, consented } from './analytics'

// ── the route gate ──────────────────────────────────────────────────────────

test('auth-artifact routes are refused, funnel routes are not', () => {
  // Carry a credential in the query string -> must never emit.
  for (const p of [
    '/callback',
    '/callback/',
    '/callback/anything',
    '/login/oauth/device',
    '/login/oauth/device/',
    '/login/oauth/device/WDJB-MJHT',
  ]) {
    assert.equal(telemetryAllowed(p), false, `${p} must not emit`)
  }

  // The funnel this exists to measure: arrival -> sign-in -> session.
  for (const p of [
    '/',
    '/login',
    '/login/',
    '/signup',
    '/forgot',
    '/forget',
    '/onboarding',
    '/callbacks', // near-miss: a real route that merely starts the same way
    '/login/oauth', // the device path is the specific one, not all of oauth
  ]) {
    assert.equal(telemetryAllowed(p), true, `${p} must emit`)
  }
})

/**
 * The gate is written against literal paths, and App.tsx dispatches against its
 * own. If someone adds a route that lands on the callback or device page, this
 * fails rather than silently starting to ship codes — the same reason the token
 * suite computes from what the bundle serves instead of trusting a list.
 */
test('every auth-artifact route App.tsx dispatches is covered by the gate', () => {
  const app = fs.readFileSync(path.join(import.meta.dirname, 'App.tsx'), 'utf8')

  // Route literals compared in App.tsx: path === '…' / path.startsWith('…').
  const routes = [...app.matchAll(/path\s*(?:===\s*|\.startsWith\(\s*)'([^']+)'/g)].map((m) => m[1]!)
  assert.ok(routes.length >= 10, `expected App.tsx route literals, found ${routes.length}`)

  for (const r of routes) {
    const isAuthArtifact = r.startsWith('/callback') || r.startsWith('/login/oauth/device')
    if (isAuthArtifact) {
      assert.equal(telemetryAllowed(r), false, `App.tsx routes ${r} to an auth-artifact page; gate it`)
    }
  }

  // Both pages are actually reachable — the gate is not guarding dead routes.
  assert.ok(routes.some((r) => r.startsWith('/callback')), 'App.tsx must route /callback')
  assert.ok(
    routes.some((r) => r.startsWith('/login/oauth/device')),
    'App.tsx must route /login/oauth/device',
  )
})

// ── consent ─────────────────────────────────────────────────────────────────

test('an explicit browser opt-out turns everything off', () => {
  assert.equal(consented({ globalPrivacyControl: true }), false)
  assert.equal(consented({ doNotTrack: '1' }), false)
  assert.equal(consented({ doNotTrack: 'yes' }), false)

  assert.equal(consented(), true)
  assert.equal(consented({}), true)
  assert.equal(consented({ globalPrivacyControl: false, doNotTrack: '0' }), true)
  assert.equal(consented({ doNotTrack: null }), true)
})

// ── the wire ────────────────────────────────────────────────────────────────

const CODE = 'AUTHCODE_abc123XYZ'
const STATE = 'STATE_deadbeef'
const USER_CODE = 'WDJB-MJHT'

/** Installs the browser globals @hanzo/event reads, at a given location. */
function atLocation(href: string, pathname: string, search: string) {
  const store: Record<string, string> = {}
  const localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => void (store[k] = String(v)),
    removeItem: (k: string) => void delete store[k],
  }
  const g = globalThis as Record<string, unknown>
  g.window = {
    location: { href, pathname, search, hostname: 'hanzo.id', origin: 'https://hanzo.id' },
    addEventListener() {},
    removeEventListener() {},
    localStorage,
    screen: { width: 1440, height: 900 },
  }
  g.document = {
    referrer: '',
    title: 'Sign in',
    visibilityState: 'visible',
    addEventListener() {},
    removeEventListener() {},
  }
  g.localStorage = localStorage
  g.screen = { width: 1440, height: 900 }
  g.location = (g.window as { location: unknown }).location
}

function clearLocation() {
  const g = globalThis as Record<string, unknown>
  delete g.window
  delete g.document
  delete g.localStorage
  delete g.screen
  delete g.location
}

/** Runs the client exactly as mounted and returns everything it tried to send. */
function wireFrom(href: string, pathname: string, search: string, enabled: boolean): string {
  atLocation(href, pathname, search)
  try {
    const sent: string[] = []
    const client = createAnalytics({
      product: 'id',
      host: 'https://api.hanzo.ai',
      ingestKey: 'pk-live-TESTKEY',
      enabled,
      transport: { send: (_url: string, body: string) => void sent.push(body) },
    })
    client.init()
    client.pageview(pathname) // pathname only — the mitigation that is NOT enough
    client.captureError(new Error('boom'))
    client.flush()
    return sent.join('')
  } finally {
    clearLocation()
  }
}

test('a gated auth-artifact route puts nothing on the wire', () => {
  const cb = wireFrom(
    `https://hanzo.id/callback?code=${CODE}&state=${STATE}`,
    '/callback',
    `?code=${CODE}&state=${STATE}`,
    telemetryAllowed('/callback'),
  )
  assert.equal(cb, '', 'the callback route must emit nothing at all')
  assert.ok(!cb.includes(CODE), 'authorization code must never reach the wire')
  assert.ok(!cb.includes(STATE), 'state must never reach the wire')

  const dev = wireFrom(
    `https://hanzo.id/login/oauth/device?user_code=${USER_CODE}`,
    '/login/oauth/device',
    `?user_code=${USER_CODE}`,
    telemetryAllowed('/login/oauth/device'),
  )
  assert.equal(dev, '', 'the device route must emit nothing at all')
  assert.ok(!dev.includes(USER_CODE), 'device user_code must never reach the wire')
})

/**
 * The reason the gate exists. Passing a clean pathname is NOT what protects the
 * code — if this ever stops leaking, @hanzo/event changed and the gate's
 * justification should be re-read.
 */
test('without the gate, a clean pathname still leaks the code (why the gate exists)', () => {
  const leaked = wireFrom(
    `https://hanzo.id/callback?code=${CODE}&state=${STATE}`,
    '/callback',
    `?code=${CODE}&state=${STATE}`,
    true, // ungated
  )
  assert.ok(leaked.includes(CODE), 'expected the ungated client to leak the code via `url`')
  assert.ok(leaked.includes(STATE), 'expected the ungated client to leak the state via `url`')
  assert.ok(leaked.includes('"path":"/callback"'), 'and to report a clean path while doing it')
})

test('funnel routes do report, and carry no credential', () => {
  for (const p of ['/', '/login', '/signup', '/onboarding']) {
    const wire = wireFrom(`https://hanzo.id${p}`, p, '', telemetryAllowed(p))
    assert.ok(wire.includes('"$pageview"'), `${p} must report a pageview`)
    assert.ok(wire.includes('"product":"id"'), `${p} must attribute to the id product`)
    for (const secret of [CODE, STATE, USER_CODE]) {
      assert.ok(!wire.includes(secret), `${p} must not carry ${secret}`)
    }
  }
})

test('an opted-out visitor emits nothing even on a funnel route', () => {
  const wire = wireFrom(
    'https://hanzo.id/login',
    '/login',
    '',
    consented({ globalPrivacyControl: true }) && telemetryAllowed('/login'),
  )
  assert.equal(wire, '', 'GPC must suppress the whole client')
})
