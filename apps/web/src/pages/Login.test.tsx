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
import { cleanup, render, waitFor } from '@testing-library/react'
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

// ── The other door ───────────────────────────────────────────────────────────
// The heading offers two things and only one of them was a control: registration
// was 13px of text at the foot of the page, on the same line as the link for
// people who forgot a password. A visitor whose only business here is that door
// had to read past every way of signing in to find it.
test('registration is a control, and it is not in the footnote row', async () => {
  land()
  await mount([])

  const create = [...document.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Create account')
  assert.ok(create, 'the page must offer registration')
  assert.ok(
    create.className.split(' ').includes('hanzo-id-btn'),
    `registration must be a control, not a sentence; it rendered as "${create.className}"`,
  )

  // Carrying the whole OIDC request is what lets registration return the new
  // account to the app that asked for it.
  const to = new URL(create.getAttribute('href')!, 'https://hanzo.id')
  assert.equal(to.pathname, '/signup')
  for (const k of ['client_id', 'redirect_uri', 'state', 'code_challenge']) {
    assert.ok(to.searchParams.get(k), `${k} must survive the hop to /signup`)
  }

  // What is left at the foot is the one link that belongs there.
  const foot = document.querySelector('.hanzo-id-footer-links')!
  assert.equal(foot.textContent?.trim(), 'Forgot password?')
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
