/**
 * The sign-up funnel, asserted where it is true or false: the bytes the mounted
 * page hands to the network.
 *
 * Two things are being proved at once, and neither is visible in a unit test of
 * a pure function.
 *
 * WHAT IS COUNTED. `signup_viewed` -> `signup_submitted` -> `signup_completed`,
 * each exactly once per real moment. The page mounts under StrictMode and under
 * a provider that swaps an inert client for a live one mid-flight, so "fires on
 * mount" and "arrives once" are different claims and only the second one matters.
 *
 * WHAT IS NOT. `/signup` is reached carrying the whole downstream OIDC request —
 * `client_id`, `redirect_uri`, `state`, `code_challenge`, `nonce` — because the
 * account has to end up back at the app that asked for it. @hanzo/event stamps
 * `url` from `window.location.href` and `referrer` from `document.referrer`
 * inside `build()`, for every event and every call site, so a page cannot keep
 * that request off the wire by choosing its arguments carefully. The door in
 * analytics.tsx is what keeps it off, and the last test here is the measurement
 * that says so: the same view, sent without the door, ships all of it.
 */
import { StrictMode } from 'react'
import { afterEach, beforeEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createAnalytics, EVENTS } from '@hanzo/event'
import { AnalyticsProvider } from '@hanzo/event/react'
import { resetRuntime, type BrandContract } from '@hanzo/id-shared'
import { createAuthClient } from '@hanzo/id-auth'
import { Analytics } from './analytics'
import { Signup } from './pages/Signup'

const KEY = 'pk-luxKEY00000000000'

const SERVED = {
  iamTenantConfigJson: JSON.stringify({ 'lux.id': { orgId: 'lux', clientId: 'lux-cloud' } }),
  ingestKeyring: JSON.stringify({ lux: KEY }),
  v: 1,
}

// The downstream request, exactly as Login hands it on: an app asked for a code,
// and every one of these has to survive the hop to /signup for the new account to
// end up back at that app holding one.
const REDIRECT = 'https://dex.lux.network/auth/callback'
const STATE = 'QxkkRKHhvzOvqJm0AqrdG2lhcWmnYk_sSibOcj28USw'
const CHALLENGE = 'AgX39Cb83kllF6GA7XywQjfcBY8fJhLFTbT_dIbqR2c'
const NONCE = 'n-0S6_WzA2Mj'
const CODE = 'c-mintedAuthorizationCode'
const REQUEST = new URLSearchParams({
  client_id: 'lux-cloud',
  response_type: 'code',
  redirect_uri: REDIRECT,
  scope: 'openid profile email',
  state: STATE,
  code_challenge: CHALLENGE,
  code_challenge_method: 'S256',
  nonce: NONCE,
})

// A person's credentials. Neither may appear anywhere in what is sent.
const EMAIL = 'newcustomer@example.test'
const PASSWORD = 'correct horse battery staple'

const REFUSAL = 'the application does not allow to sign up new account'

const ORG = {
  orgId: 'lux',
  iamUrl: 'https://lux.id',
  iamIssuer: 'https://lux.id',
  clientId: 'lux-cloud',
  appName: 'lux-cloud',
  publicOrigin: 'https://lux.id',
  brandPackage: '@luxfi/brand',
} as Parameters<typeof createAuthClient>[0]['org']

const BRAND = { name: 'Lux', logoUrl: '', faviconUrl: '' } as unknown as BrandContract

// ── the wire ─────────────────────────────────────────────────────────────────

interface Beacon {
  readonly key: string | undefined
  events: { event?: string; url?: string; path?: string; referrer?: string }[]
}

let sent: Beacon[]
let bodies: Promise<void>[]
/** How much had been handed to the network at the moment the browser left. */
let atExit: number

/**
 * Serves /config.json and records every ingest POST, on either transport.
 *
 * A beacon's body is a Blob and reads back asynchronously, so the request takes
 * its place in `sent` the moment it is made and fills in afterwards. That order
 * is the point: whether the completed sign-up left BEFORE the navigation is a
 * question about when the send happened, not about when the bytes parsed.
 */
function wire() {
  sent = []
  bodies = []
  atExit = -1
  const record = (body: string | Promise<string>, key: string | undefined) => {
    const slot: Beacon = { key, events: [] }
    sent.push(slot)
    const fill = (b: string) => void (slot.events = (JSON.parse(b) as { batch?: Beacon['events'] }).batch ?? [])
    if (typeof body === 'string') fill(body)
    else bodies.push(body.then(fill))
  }
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).includes('/config.json')) {
      return { ok: true, json: async () => SERVED } as unknown as Response
    }
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization
    record(String(init?.body ?? '{}'), auth?.replace(/^Bearer /, ''))
    return { ok: true, status: 200, text: async () => '{}' } as unknown as Response
  })
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: (url: string, blob: Blob) => {
      const key = new URL(String(url), 'https://x.test').searchParams.get('ingest_key') ?? undefined
      record(blob.text(), key)
      return true
    },
  })
}

/** Every event delivered, in order, flattened out of its batch. */
function events() {
  return sent.flatMap((b) => b.events)
}

function count(name: string): number {
  return events().filter((e) => e.event === name).length
}

/** Everything that was sent, as one string — what a reader of the ingest sees. */
function bytes(upTo = sent.length): string {
  return JSON.stringify(sent.slice(0, upTo))
}

// ── the page ─────────────────────────────────────────────────────────────────

type Outcome = 'ok' | 'refused' | 'pending' | 'mfa'

/** An IAM double: it registers the account, or refuses, or never answers. */
function iam(outcome: Outcome, enableSignUp = true): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(input.toString()).pathname
    if (path === '/v1/iam/signup') {
      if (outcome === 'pending') return new Promise<Response>(() => {})
      if (outcome === 'refused') return json({ status: 'error', msg: REFUSAL })
    }
    // A credential check that passes answers with the freshly minted code, which
    // the client turns into a redirect back to the app.
    if (path === '/v1/iam/login') return json({ status: 'ok', data: outcome === 'mfa' ? 'RequiredMfa' : CODE })
    if (path === '/v1/iam/get-app-login') return json({ status: 'ok', data: { enableSignUp } })
    void init
    return json({ status: 'ok', data: {} })
  }) as unknown as typeof fetch
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Puts the document at the sign-up page of an app-initiated request and records
 * where the page sends the browser instead of letting happy-dom navigate.
 *
 * The getter keeps answering the real address: it is the input under test, and a
 * stand-in that reported something tidier would prove the opposite of the point.
 */
function land(referrer = `https://lux.id/login?${REQUEST}`): string[] {
  const w = window as unknown as { happyDOM: { setURL(u: string): void } }
  w.happyDOM.setURL(`https://lux.id/signup?${REQUEST}`)
  Object.defineProperty(document, 'referrer', { configurable: true, value: referrer })
  const here = window.location.href
  const gone: string[] = []
  Object.defineProperty(window.location, 'href', {
    configurable: true,
    get: () => here,
    set: (u: string) => {
      gone.push(u)
      atExit = sent.length
    },
  })
  return gone
}

/**
 * Mounts the page as main.tsx does, and lets the live client reach it.
 *
 * Returns the container so everything after this reads THIS render. Queried
 * against the whole document instead, a tree another test left behind is a
 * second form, and one click on it counts twice.
 */
async function mount(outcome: Outcome = 'ok', enableSignUp = true): Promise<HTMLElement> {
  const { container } = render(
    <StrictMode>
      <Analytics>
        <Signup client={createAuthClient({ org: ORG, fetchImpl: iam(outcome, enableSignUp) })} brand={BRAND} />
      </Analytics>
    </StrictMode>,
  )
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  return container
}

/** Fills the form and submits it `times` times, without waiting in between. */
async function submit(page: HTMLElement, times = 1) {
  await waitFor(() => assert.ok(page.querySelector('input[type=password]')))
  const email = page.querySelector('input[type=email]') as HTMLInputElement
  const password = page.querySelector('input[type=password]') as HTMLInputElement
  const button = page.querySelector('button[type=submit]') as HTMLButtonElement
  await act(async () => {
    fireEvent.change(email, { target: { value: EMAIL } })
    fireEvent.change(password, { target: { value: PASSWORD } })
  })
  for (let i = 0; i < times; i++) await act(async () => void fireEvent.click(button))
}

/** Delivers whatever is still buffered, the way leaving the page delivers it. */
async function leave() {
  await act(async () => void window.dispatchEvent(new Event('pagehide')))
  await Promise.all(bodies)
}

beforeEach(() => {
  resetRuntime()
  wire()
})

afterEach(() => {
  cleanup()
  // A client outlives the tree that built it: `init()` subscribes to `pagehide`
  // for the life of the document and nothing unsubscribes. Drain any left
  // holding events here, or the next test's `leave()` delivers them too and
  // counts them as its own.
  window.dispatchEvent(new Event('pagehide'))
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ── what is counted ──────────────────────────────────────────────────────────

test('the view is counted once, on the brand\'s key', async () => {
  land()
  await mount()
  await leave()

  assert.equal(count(EVENTS.SIGNUP_VIEWED), 1, `one arrival, one view — got ${count(EVENTS.SIGNUP_VIEWED)}`)
  for (const b of sent) assert.equal(b.key, KEY, 'every request rides the Lux key')
})

/**
 * The same claim with the portal's own client swap taken out of it.
 *
 * Mounted under `Analytics`, the arrival is counted once whatever the page does,
 * because StrictMode's second effect lands while the provider is still inert and
 * an inert client counts nothing. Handed a live client from the first render —
 * which is what a portal that already knew its key would do — "once per mount"
 * has to be the page's own property, and this is where it is one.
 */
test('a live client mounted twice is still one view', async () => {
  land()
  const raw: string[] = []
  const client = createAnalytics({
    product: 'id',
    host: 'https://api.hanzo.ai',
    ingestKey: KEY,
    enabled: true,
    transport: { send: (_u: string, body: string) => void raw.push(body) },
  })
  render(
    <StrictMode>
      <AnalyticsProvider client={client} autoPageview={false}>
        <Signup client={createAuthClient({ org: ORG, fetchImpl: iam('ok') })} brand={BRAND} />
      </AnalyticsProvider>
    </StrictMode>,
  )
  await act(async () => void (await Promise.resolve()))
  client.flush()

  const views = raw.join('').split(EVENTS.SIGNUP_VIEWED).length - 1
  assert.equal(views, 1, `one mount, one view — got ${views}`)
})

test('a page that takes no new accounts still counts the view', async () => {
  land()
  const page = await mount('ok', false)
  await waitFor(() => assert.ok(page.textContent?.includes('does not accept new accounts')))
  await leave()

  assert.equal(count(EVENTS.SIGNUP_VIEWED), 1, 'a refusal is an outcome, not a hole in the funnel')
  assert.equal(count(EVENTS.SIGNUP_SUBMITTED), 0)
})

test('a double click is one submission', async () => {
  land()
  const page = await mount('pending')
  await submit(page, 2)
  await leave()

  assert.equal(count(EVENTS.SIGNUP_SUBMITTED), 1, 'the busy guard makes an impatient second click one attempt')
  assert.equal(count(EVENTS.SIGNUP_COMPLETED), 0, 'nothing has been created yet')
})

test('a completed sign-up is counted, and leaves before the browser does', async () => {
  const gone = land()
  const page = await mount()
  await submit(page)
  await waitFor(() => assert.equal(gone.length, 1, 'the new account is sent back to the app'))
  await Promise.all(bodies)

  assert.equal(count(EVENTS.SIGNUP_SUBMITTED), 1)
  assert.equal(count(EVENTS.SIGNUP_COMPLETED), 1)
  // A batch waiting on the flush timer does not survive a navigation, so the
  // completion has to have been handed over already when the browser left.
  assert.ok(atExit > 0, 'something was sent before the navigation')
  assert.ok(
    bytes(atExit).includes(EVENTS.SIGNUP_COMPLETED),
    'the completion must be on the network before the page goes',
  )
  assert.ok(gone[0]!.startsWith(REDIRECT), 'and the browser goes to the app that asked')
})

/**
 * An org that forces a second factor answers the sign-in with an enrolment step
 * instead of a code. The ACCOUNT exists either way, which is what `signup_completed`
 * names — measuring it on the redirect alone reads every MFA org as a funnel that
 * nobody finishes.
 */
test('a second factor still completes the sign-up', async () => {
  const gone = land()
  const page = await mount('mfa')
  await submit(page)
  await waitFor(() => assert.equal(gone.length, 1, 'the enrolment step is at sign-in'))
  await Promise.all(bodies)

  assert.equal(count(EVENTS.SIGNUP_COMPLETED), 1)
  assert.ok(gone[0]!.startsWith('/login'), `handed to sign-in, got ${gone[0]}`)
  assert.ok(bytes(atExit).includes(EVENTS.SIGNUP_COMPLETED), 'and it left before the browser did')
})

test('a refused sign-up is submitted and never completed', async () => {
  land()
  const page = await mount('refused')
  await submit(page)
  await waitFor(() => assert.ok(page.textContent?.includes(REFUSAL)))
  await leave()

  assert.equal(count(EVENTS.SIGNUP_SUBMITTED), 1)
  assert.equal(count(EVENTS.SIGNUP_COMPLETED), 0, 'a refusal is submitted-and-not-completed')
  assert.ok(!bytes().includes(REFUSAL), 'IAM\'s message is free text about a person; it stays there')
})

// ── what is not ──────────────────────────────────────────────────────────────

test('the OIDC request never leaves the browser', async () => {
  const gone = land()
  const page = await mount()
  await submit(page)
  await waitFor(() => assert.equal(gone.length, 1))
  await leave()

  assert.ok(events().length >= 3, 'there is something to inspect')
  const all = bytes()
  for (const [what, secret] of [
    ['state', STATE],
    ['the PKCE challenge', CHALLENGE],
    ['the nonce', NONCE],
    ['the redirect_uri', REDIRECT],
    ['the authorization code', CODE],
    ['the address', EMAIL],
    ['the password', PASSWORD],
  ] as const) {
    assert.ok(!all.includes(secret), `${what} must never reach the wire`)
  }

  // And the measurement survives the redaction: every event still says which
  // page it happened on.
  for (const e of events()) {
    assert.equal(e.path, '/signup')
    assert.equal(e.url, 'https://lux.id/signup')
    assert.equal(e.referrer, 'https://lux.id/login', 'referrer must be present and bared')
  }
})

/**
 * Why the door exists. The same view, sent by an unmodified client from the same
 * document, ships the whole request — so if this ever stops leaking, @hanzo/event
 * has changed and analytics.tsx can be re-read.
 */
test('sent without the door, the same view ships the whole request', async () => {
  land()
  const raw: string[] = []
  const client = createAnalytics({
    product: 'id',
    host: 'https://api.hanzo.ai',
    ingestKey: KEY,
    enabled: true,
    transport: { send: (_u: string, body: string) => void raw.push(body) },
  })
  client.init()
  client.capture(EVENTS.SIGNUP_VIEWED)
  client.flush()

  const leaked = raw.join('')
  for (const secret of [STATE, CHALLENGE, NONCE]) {
    assert.ok(leaked.includes(secret), `expected the undoored client to ship ${secret} via url`)
  }
  assert.ok(leaked.includes('"path":"/signup"'), 'and to report a clean path while doing it')
})
