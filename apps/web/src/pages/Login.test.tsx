/**
 * What the hosted login page may do BEFORE a person has typed anything.
 *
 * The answer is: read, never write. It may ask which methods this application
 * offers — that is what draws the form — and it must not post a credential
 * attempt, because it has no credential to post.
 *
 * This page used to open with `POST /v1/iam/login {type:'code', application}`
 * on mount, a bid to mint an authorization code from an ambient issuer session.
 * Two things were wrong with it, and the tests below pin both.
 *
 * It could not succeed. Single sign-on belongs to the issuer and runs one hop
 * upstream: `/v1/iam/oauth/authorize` calls `silentGrant` and, when a session
 * answers, 302s to the app's redirect_uri with a code — this page never loads.
 * Landing here already means that refused, so the mount POST re-asked a
 * question that had just been answered no and took a 400 (`login_required`)
 * every time. It sat in the console of every sign-in wearing the same shape as
 * a real credential failure, which is the kind of alarm that costs someone an
 * hour during an actual incident.
 *
 * Where it COULD succeed, it should not have. `prompt=login` and `max_age` are
 * how a relying party demands fresh proof before something sensitive; IAM
 * honours them by skipping its silent branch and sending the person here for a
 * screen. The mount POST then minted from the same ambient session anyway and
 * bounced through with no screen shown — measured against production, both.
 */
import { afterEach, test } from 'vitest'
import assert from 'node:assert/strict'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import type { Brand } from '@hanzo/id-shared'
import { createAuthClient } from '@hanzo/id-auth'
import { Login } from './Login'

afterEach(cleanup)

const ORG = {
  orgId: 'hanzo',
  iamUrl: 'https://hanzo.id',
  iamIssuer: 'https://hanzo.id',
  clientId: 'hanzo-console',
  appName: 'hanzo-console',
  publicOrigin: 'https://hanzo.id',
  brandPackage: '@hanzo/brand',
} as Parameters<typeof createAuthClient>[0]['org']

const BRAND = { name: 'Hanzo', logoUrl: '', faviconUrl: '' } as unknown as Brand

type Call = { url: string; method: string }

/** An IAM double that records every call and answers reads with an empty app. */
function iam(calls: Call[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: input.toString(), method: init?.method ?? 'GET' })
    return new Response(JSON.stringify({ status: 'ok', data: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

/**
 * The exact address IAM redirects to when silent SSO did not answer — the one
 * from the production capture, PKCE and all. `search` is what the page reads.
 */
function land(extra: Record<string, string> = {}) {
  const q = new URLSearchParams({
    client_id: 'hanzo-cloud',
    response_type: 'code',
    redirect_uri: 'https://console.hanzo.ai/auth/callback',
    scope: 'openid profile email',
    state: 'QxkkRKHhvzOvqJm0AqrdG2lhcWmnYk_sSibOcj28USw',
    code_challenge: 'AgX39Cb83kllF6GA7XywQjfcBY8fJhLFTbT_dIbqR2c',
    code_challenge_method: 'S256',
    ...extra,
  })
  window.history.replaceState({}, '', `/login/oauth/authorize?${q}`)
}

/** Mount the page and let its app-config reads settle. */
async function mount(calls: Call[]) {
  render(<Login client={createAuthClient({ org: ORG, fetchImpl: iam(calls) })} brand={BRAND} />)
  await waitFor(() => assert.ok(document.querySelector('form, input')))
}

test('lands on an authorize request and writes nothing — no credential attempt on mount', async () => {
  const calls: Call[] = []
  land()
  await mount(calls)

  const writes = calls.filter((c) => c.method.toUpperCase() !== 'GET')
  assert.deepEqual(
    writes,
    [],
    `the page must not write before a person acts; it sent ${JSON.stringify(writes)}`,
  )
  assert.equal(
    calls.some((c) => new URL(c.url).pathname === '/v1/iam/login'),
    false,
    '/v1/iam/login is a credential attempt — nothing to attempt yet',
  )
})

test('the credential form is what renders, immediately', async () => {
  const calls: Call[] = []
  land()
  await mount(calls)

  // Not a "Signing you in…" holding screen while a doomed mint round-trips: the
  // person is signed out, and the form is the whole reason they are here.
  assert.equal(document.querySelectorAll('input[type=password]').length, 1)
  assert.equal(document.querySelector('main')?.getAttribute('aria-busy'), null)
})

test('prompt=login gets a screen, never a silent mint', async () => {
  const calls: Call[] = []
  // IAM forwards the surviving prompt here precisely BECAUSE it declined to
  // answer from the session (authorize.go: `q.prompt = p.forwarded()`). The
  // page must not overturn that.
  land({ prompt: 'login' })
  await mount(calls)

  assert.equal(
    calls.some((c) => new URL(c.url).pathname === '/v1/iam/login'),
    false,
    'a re-authentication request must not be satisfied from an ambient session',
  )
  assert.equal(document.querySelectorAll('input[type=password]').length, 1)
})

// ── The column ───────────────────────────────────────────────────────────────
// The page opens on the credential form, then "or", then every other way in —
// each drawn only when the application can complete it — and closes on the way
// to registration, drawn only when the application takes new accounts.

/** An IAM double for an application that offers everything the column can draw. */
function offersAll(enableSignUp = true): typeof fetch {
  const json = (data: unknown) =>
    new Response(JSON.stringify({ status: 'ok', data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const provider = (key: string, type: string) => ({
    name: `provider-${key}`,
    canSignIn: true,
    provider: { name: `provider-${key}`, type, clientId: `${key}-real-client-id` },
  })
  return (async (input: RequestInfo | URL) => {
    const path = new URL(input.toString()).pathname
    if (path === '/v1/iam/auth/methods') return json({ web3Chains: ['evm'] })
    if (path === '/v1/iam/auth/application')
      return json({
        owner: 'admin',
        name: 'hanzo-console',
        organization: 'hanzo',
        enablePassword: true,
        enableCodeSignin: true,
        enableSignUp,
        providers: [provider('github', 'GitHub'), provider('google', 'Google')],
      })
    return json({})
  }) as unknown as typeof fetch
}

/** What a person reads down the page, in document order. */
function column(): string[] {
  const nodes = document.querySelectorAll(
    'h1, .hanzo-id-field > span, .hanzo-id-field > label, button:not(.hanzo-id-revealbtn), .hanzo-id-divider, .hanzo-id-footer-links a',
  )
  return [...nodes].map((n) => n.textContent?.trim() ?? '')
}

test('the credential form leads, then "or", then the other ways in, then Create account', async () => {
  land()
  render(<Login client={createAuthClient({ org: ORG, fetchImpl: offersAll() })} brand={BRAND} />)
  await waitFor(() => assert.ok(document.querySelector('[data-provider="phone"]')))
  await waitFor(() => assert.ok(document.querySelector('a[href^="/signup"]')))

  assert.deepEqual(column(), [
    'Sign in',
    'Email or username',
    'Password',
    'Continue',
    'Send me a code instead',
    'or',
    'Continue with Google',
    'Continue with GitHub',
    'Continue with Wallet',
    'Continue with Phone',
    'Forgot password?',
    'Create account',
  ])
  assert.ok(document.body.textContent?.includes("Don't have an account? Create account"))
})

test('Create account opens registration for the same application, with the whole request', async () => {
  land({ nonce: 'n-1', prompt: 'login' })
  const here = new URLSearchParams(window.location.search)
  render(<Login client={createAuthClient({ org: ORG, fetchImpl: offersAll() })} brand={BRAND} />)
  await waitFor(() => assert.ok(document.querySelector('a[href^="/signup"]')))

  const to = new URL((document.querySelector('a[href^="/signup"]') as HTMLAnchorElement).getAttribute('href')!, 'https://hanzo.id')
  assert.equal(to.pathname, '/signup')
  assert.deepEqual([...to.searchParams], [...here], 'every parameter reaches registration')
  assert.equal(to.searchParams.get('client_id'), 'hanzo-cloud')
  assert.equal(to.searchParams.get('redirect_uri'), 'https://console.hanzo.ai/auth/callback')
})

test('Create account on /login/<app> opens /signup/<app>', async () => {
  window.history.replaceState({}, '', '/login/hanzo-chat')
  render(<Login client={createAuthClient({ org: ORG, fetchImpl: offersAll() })} brand={BRAND} />)
  await waitFor(() => assert.ok(document.querySelector('a[href^="/signup"]')))
  assert.equal((document.querySelector('a[href^="/signup"]') as HTMLAnchorElement).getAttribute('href'), '/signup/hanzo-chat')
})

/** Every fetch `read` answers, settled: the page has heard everything it asked. */
async function settled(pending: Promise<unknown>[]) {
  await act(async () => {
    await Promise.allSettled(pending)
    await new Promise((r) => setTimeout(r, 0))
  })
}

/** `read`, remembering each answer it hands out. */
function remembering(read: typeof fetch, pending: Promise<unknown>[]): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const answer = read(input, init)
    pending.push(answer)
    return answer
  }) as typeof fetch
}

function noRegistration() {
  const text = document.body.textContent ?? ''
  assert.equal(text.includes('Create account'), false, 'no registration control')
  assert.equal(text.includes('have an account'), false, 'no registration prompt')
  assert.equal(document.querySelector('a[href^="/signup"]'), null, 'nothing links to /signup')
}

test('an application that takes no new accounts offers no way to create one', async () => {
  land()
  const pending: Promise<unknown>[] = []
  render(<Login client={createAuthClient({ org: ORG, fetchImpl: remembering(offersAll(false), pending) })} brand={BRAND} />)
  await waitFor(() => assert.ok(document.querySelector('[data-provider="phone"]')))
  await settled(pending)
  noRegistration()
})

test('an application config that cannot be read offers no way to create one', async () => {
  land()
  const pending: Promise<unknown>[] = []
  const down = (async () => new Response('no available server', { status: 503 })) as unknown as typeof fetch
  render(<Login client={createAuthClient({ org: ORG, fetchImpl: remembering(down, pending) })} brand={BRAND} />)
  await waitFor(() => assert.ok(document.querySelector('input[type=password]')))
  await settled(pending)
  noRegistration()
})

// ── The registration hint ────────────────────────────────────────────────────
// hanzo.app's "Get started" forwards `signup=true` on the authorize request and
// this page ignored it, so a net-new customer landed on "Sign in to Hanzo ID"
// with empty credentials and had to spot the small "Create account" link.
//
// The hint used to be deliberately ranked BELOW the mount-time silent mint, on
// the grounds that a browser holding an issuer session belongs to someone who
// already has an account and must not be sent to registration. That ordering is
// gone with the mint, and the property it protected now holds by construction:
// such a browser is answered by `silentGrant` at the issuer and never arrives
// here. Nothing left to lose to.

/** Record where the page sends the browser instead of navigating the test DOM. */
function trapNavigation(): string[] {
  const gone: string[] = []
  // Shadow the method, not the Location object: happy-dom's Location keeps its
  // state in private fields, so a stand-in built from it throws on first read.
  Object.defineProperty(window.location, 'replace', {
    configurable: true,
    value: (u: string) => void gone.push(u),
  })
  return gone
}

for (const hint of ['signup', 'screen_hint'] as const) {
  const value = hint === 'signup' ? 'true' : 'signup'
  test(`${hint}=${value} reaches registration, carrying the whole OIDC request`, async () => {
    land({ [hint]: value })
    const gone = trapNavigation()
    render(<Login client={createAuthClient({ org: ORG, fetchImpl: iam([]) })} brand={BRAND} />)

    await waitFor(() => assert.equal(gone.length, 1, 'the hint must reach /signup'))
    const to = new URL(gone[0]!, 'https://hanzo.id')
    assert.equal(to.pathname, '/signup')
    // client_id, redirect_uri, state and the PKCE challenge travel or
    // registration has nowhere to return the new account to.
    for (const k of ['client_id', 'redirect_uri', 'state', 'code_challenge']) {
      assert.ok(to.searchParams.get(k), `${k} must survive the hop to /signup`)
    }
  })
}

// ── Choosing an account ──────────────────────────────────────────────────────
// prompt=select_account reaches this page when an application asks the person
// which account to use. IAM lists the people signed in on this browser at
// /v1/iam/accounts; choosing one re-enters authorize naming them, and IAM answers
// from that person's session.

const ALICE = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'
const PEOPLE = [
  { sub: 'b0b5e0a1-2c3d-4e5f-9a6b-7c8d9e0f1a2b', owner: 'acme', name: 'bob', email: 'bob@acme.dev' },
  { sub: ALICE, owner: 'hanzo', name: 'alice', displayName: 'Alice Example', email: 'alice@hanzo.ai' },
]

/** An IAM double whose accounts endpoint answers `people`. */
function signedIn(calls: Call[], people: object[]): typeof fetch {
  const rest = iam(calls)
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (new URL(input.toString()).pathname === '/v1/iam/accounts') {
      calls.push({ url: input.toString(), method: init?.method ?? 'GET' })
      return new Response(JSON.stringify({ status: 'ok', data: people }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return rest(input, init)
  }) as unknown as typeof fetch
}

const button = (text: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined

test('select_account lists the accounts signed in here, and writes nothing', async () => {
  const calls: Call[] = []
  land({ prompt: 'select_account', nonce: 'n-1' })
  render(<Login client={createAuthClient({ org: ORG, fetchImpl: signedIn(calls, PEOPLE) })} brand={BRAND} />)

  await waitFor(() => assert.ok(button('Alice Example'), 'alice is offered'))
  assert.equal(document.querySelector('h1')?.textContent, 'Choose an account')
  assert.ok(button('bob@acme.dev'), 'bob is offered')
  assert.ok(button('Use another account'), 'another account is offered')
  assert.equal(document.querySelectorAll('input[type=password]').length, 0)
  assert.deepEqual(calls.filter((c) => c.method.toUpperCase() !== 'GET'), [])
})

test('choosing an account re-enters authorize naming it, with the request this page was handed', async () => {
  land({ prompt: 'select_account', nonce: 'n-1' })
  const gone = trapNavigation()
  render(<Login client={createAuthClient({ org: ORG, fetchImpl: signedIn([], PEOPLE) })} brand={BRAND} />)

  await waitFor(() => assert.ok(button('Alice Example')))
  button('Alice Example')!.click()

  assert.equal(gone.length, 1, 'choosing navigates once')
  const to = new URL(gone[0]!)
  assert.equal(to.origin + to.pathname, 'https://hanzo.id/v1/iam/oauth/authorize')
  assert.equal(to.searchParams.get('login_hint'), ALICE, 'named by subject, which no two accounts share')
  assert.equal(to.searchParams.get('prompt'), null, 'the choice is made; asking again would loop')
  assert.equal(to.searchParams.get('client_id'), 'hanzo-cloud')
  assert.equal(to.searchParams.get('redirect_uri'), 'https://console.hanzo.ai/auth/callback')
  assert.equal(to.searchParams.get('state'), 'QxkkRKHhvzOvqJm0AqrdG2lhcWmnYk_sSibOcj28USw')
  assert.equal(to.searchParams.get('code_challenge'), 'AgX39Cb83kllF6GA7XywQjfcBY8fJhLFTbT_dIbqR2c')
  assert.equal(to.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(to.searchParams.get('nonce'), 'n-1')
  assert.equal(to.searchParams.get('scope'), 'openid profile email')
})

test('use another account opens the credential form', async () => {
  land({ prompt: 'select_account' })
  render(<Login client={createAuthClient({ org: ORG, fetchImpl: signedIn([], PEOPLE) })} brand={BRAND} />)

  await waitFor(() => assert.ok(button('Use another account')))
  button('Use another account')!.click()
  await waitFor(() => assert.equal(document.querySelectorAll('input[type=password]').length, 1))
})

test('select_account with nobody signed in here is the credential form', async () => {
  land({ prompt: 'select_account' })
  render(<Login client={createAuthClient({ org: ORG, fetchImpl: signedIn([], []) })} brand={BRAND} />)

  await waitFor(() => assert.equal(document.querySelectorAll('input[type=password]').length, 1))
  assert.equal(button('Use another account'), undefined)
})

test('login_hint starts the form with the account the application named', async () => {
  land({ login_hint: 'alice@hanzo.ai' })
  await mount([])

  const field = document.querySelector('input[autocomplete=username]') as HTMLInputElement
  assert.equal(field.value, 'alice@hanzo.ai')
})

test('a subject in login_hint is not typed into the form', async () => {
  for (const hint of [ALICE, 'hanzo/alice']) {
    cleanup()
    land({ login_hint: hint })
    await mount([])
    const field = document.querySelector('input[autocomplete=username]') as HTMLInputElement
    assert.equal(field.value, '', `${hint} is not an identifier a person types`)
  }
})
