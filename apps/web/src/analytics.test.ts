/**
 * The telemetry gate, tested where it is actually true or false: on the bytes
 * the client puts on the wire.
 *
 * The defect this guards is not hypothetical and is not visible in review. The
 * obvious way to keep an OAuth artifact out of telemetry — "send the pathname,
 * never the href" — DOES NOT WORK against @hanzo/event, because `build()` stamps
 * `url: window.location.href` onto every event it assembles regardless of the
 * `path` the caller passed. The client redacts a query value by the NAME it is
 * filed under — `code`, `state`, `nonce`, `token` and a list more — and a device
 * `user_code` is not on that list, so a pageview from
 * `/login/oauth/device?user_code=…` ships the code while `path` reads a clean
 * `/login/oauth/device`. No list names every parameter an identity flow will
 * carry, which is why the gate is written against the ROUTE and not a name.
 *
 * So the gate is "do not emit from a route whose URL carries a credential", and
 * the test below asserts BOTH halves: that gated routes emit nothing, and that
 * the same setup ungated really does ship what the client does not redact. The
 * second half is what keeps this from decaying into a decorative assertion — if
 * it ever stops leaking, @hanzo/event changed and this whole file can be
 * revisited.
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createAnalytics } from '@hanzo/event'
import { bare, telemetryAllowed, consented } from './analytics'
import { newDocument } from './document'

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

// ── the location that leaves ────────────────────────────────────────────────

/** One event as the client assembles it, with the fields a location lives in. */
function batch(e: Record<string, unknown>): string {
  return JSON.stringify({ batch: [{ messageId: 'm', type: 'event', event: 'signup_viewed', ...e }] })
}

function first(body: string): Record<string, unknown> {
  return (JSON.parse(body) as { batch: Record<string, unknown>[] }).batch[0]!
}

test('a location leaves as its path, in every field that holds one', () => {
  const e = first(
    bare(
      batch({
        url: 'https://lux.id/signup?state=S&code_challenge=C&nonce=N#frag',
        path: '/signup',
        referrer: 'https://lux.id/login?state=S&code_challenge=C',
      }),
    ),
  )
  assert.equal(e.url, 'https://lux.id/signup')
  assert.equal(e.referrer, 'https://lux.id/login')
  assert.equal(e.path, '/signup', 'the part a funnel reads is untouched')
})

test('an address with nothing to drop is unchanged, and an absent one stays absent', () => {
  const e = first(bare(batch({ url: 'https://lux.id/login', path: '/login' })))
  assert.equal(e.url, 'https://lux.id/login')
  // Not the empty string: `host` is derived from `url`, and an empty one reads
  // as a page that does not exist.
  assert.equal('referrer' in e, false)
})

test('everything that is not a location survives the door', () => {
  const e = first(bare(batch({ url: 'https://lux.id/signup?state=S', properties: { plan: 'free' } })))
  assert.equal(e.event, 'signup_viewed')
  assert.deepEqual(e.properties, { plan: 'free' })
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

/** A new document: the browser globals @hanzo/event reads, at a given location. */
function atLocation(href: string, pathname: string, search: string) {
  newDocument()
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
 * artifact, and neither is the client's redaction: that works by NAME, and
 * `user_code` is not a name it knows. If this ever stops leaking, @hanzo/event
 * changed and the gate's justification should be re-read.
 */
test('without the gate, a clean pathname still ships the device code (why the gate exists)', () => {
  const leaked = wireFrom(
    `https://hanzo.id/login/oauth/device?user_code=${USER_CODE}`,
    '/login/oauth/device',
    `?user_code=${USER_CODE}`,
    true, // ungated
  )
  assert.ok(leaked.includes(USER_CODE), 'expected the ungated client to ship the user_code via `url`')
  assert.ok(leaked.includes('"path":"/login/oauth/device"'), 'and to report a clean path while doing it')

  // The callback's `code` and `state` ARE names the client knows, and it redacts
  // them itself. That is one dependency's list, not this page's rule: the gate
  // refuses the route either way.
  const callback = wireFrom(
    `https://hanzo.id/callback?code=${CODE}&state=${STATE}`,
    '/callback',
    `?code=${CODE}&state=${STATE}`,
    true, // ungated
  )
  assert.ok(callback.includes('"$pageview"'), 'the ungated callback does emit')
  assert.ok(!callback.includes(CODE) && !callback.includes(STATE), 'with code and state redacted by name')
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
