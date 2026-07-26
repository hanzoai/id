import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createAuthClient } from './client.ts'
import type { TenantConfig } from '@hanzo/id-shared'

// A capturing fetch double: records the URL + parsed JSON body of the last call
// and returns a canned IAM "ok" response. No network.
function capturingFetch() {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString()
    let body: Record<string, unknown> = {}
    if (init?.body && typeof init.body === 'string') body = JSON.parse(init.body)
    calls.push({ url, body })
    return new Response(JSON.stringify({ status: 'ok', data: 'AUTHCODE' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return { calls, fetchImpl }
}

// A routing fetch double for the silent-SSO org gate: silentLogin resolves the
// app's org (`/v1/iam/get-app-login`) and the ambient session's owner
// (`/v1/iam/get-account`) BEFORE minting a code (`/v1/iam/login`). This lets a
// test set the app org + session owner independently and assert whether the mint
// leg ran. `sessionOwner: null` models "no live session" (get-account errors).
function routingFetch(opts: { appOrg: string; sessionOwner: string | null; code?: string }) {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const json = (payload: unknown) =>
    new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString()
    let body: Record<string, unknown> = {}
    if (init?.body && typeof init.body === 'string') body = JSON.parse(init.body)
    calls.push({ url, body })
    if (url.includes('/get-app-login')) {
      return json({ status: 'ok', data: { name: 'app', organization: opts.appOrg, providers: [] } })
    }
    if (url.includes('/get-account')) {
      return opts.sessionOwner
        ? json({ status: 'ok', data: { owner: opts.sessionOwner, name: 'z' } })
        : json({ status: 'error', msg: 'please sign in first' })
    }
    return json({ status: 'ok', data: opts.code ?? 'AUTHCODE' })
  }
  return { calls, fetchImpl }
}

function tenant(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    orgId: 'hanzo',
    iamUrl: 'https://hanzo.id',
    iamIssuer: 'https://hanzo.id',
    clientId: 'hanzo-console',
    appName: 'hanzo-console',
    publicOrigin: 'https://hanzo.id',
    oauthCallbackOrigin: 'https://hanzo.id',
    brandPackage: '@hanzo/brand',
    ...overrides,
  }
}

// `client.login` is a PURE PASSTHROUGH for `organization`: it sends what the
// caller gave it and omits the key when there is nothing to send. That is the
// contract these two tests pin, and it is unchanged.
//
// What DID change is whose job it is to supply one. This used to be deliberate
// omission — IAM resolved the user cross-org so a colliding identity
// (z@hanzo.ai exists in both `admin` and `hanzo`) landed on admin/* with a full
// multi-org session. iam2 removed that on purpose, treating the collision as a
// defect ("the F-2 bug where z@hanzo.ai collided across admin and hanzo": it
// coupled lockout counters across rows and gave a brute-force oracle on the
// superadmin), and now REFUSES an org-less login. So LoginForm resolves the
// app's own org via get-app-login and always passes one. Do not re-add an
// omit-the-org path here expecting the server to figure it out — it will not,
// and it fails with an HTTP 200 that reads like a wrong password.
test('login omits organization when the caller supplies none', async () => {
  const { calls, fetchImpl } = capturingFetch()
  const client = createAuthClient({ tenant: tenant(), fetchImpl })

  await client.login({
    identifier: 'z@hanzo.ai',
    password: 'pw',
    clientId: 'hanzo-console',
    application: 'hanzo-console',
    // organization intentionally not provided — LoginForm now always resolves one
  })

  assert.equal(calls.length, 1)
  assert.equal(
    'organization' in calls[0]!.body,
    false,
    'organization must be absent when the caller supplies none — the client never invents one',
  )
  // The identity + app still ride the request.
  assert.equal(calls[0]!.body.username, 'z@hanzo.ai')
  assert.equal(calls[0]!.body.application, 'hanzo-console')
})

// An empty-string org is treated the same as unset (defensive: a catalog might
// emit "").
test('login omits organization when it is an empty string', async () => {
  const { calls, fetchImpl } = capturingFetch()
  const client = createAuthClient({ tenant: tenant(), fetchImpl })
  await client.login({
    identifier: 'z@hanzo.ai',
    password: 'pw',
    clientId: 'hanzo-console',
    application: 'hanzo-console',
    organization: '',
  })
  assert.equal('organization' in calls[0]!.body, false)
})

// A brand that DELIBERATELY scopes its portal to one org can still force it.
test('login INCLUDES organization when one is explicitly provided', async () => {
  const { calls, fetchImpl } = capturingFetch()
  const client = createAuthClient({ tenant: tenant(), fetchImpl })
  await client.login({
    identifier: 'someone',
    password: 'pw',
    clientId: 'hanzo-console',
    application: 'hanzo-console',
    organization: 'hanzo',
  })
  assert.equal(calls[0]!.body.organization, 'hanzo')
})

// Per-app SSO: the downstream app's client_id + redirect_uri still flow through;
// `type` flips to `code` and the org is STILL omitted (resolution stays correct
// for the SSO path too).
test('app SSO (redirectUri present) uses type=code and still omits organization', async () => {
  const { calls, fetchImpl } = capturingFetch()
  const client = createAuthClient({ tenant: tenant(), fetchImpl })
  await client.login({
    identifier: 'z@hanzo.ai',
    password: 'pw',
    clientId: 'hanzo-console',
    application: 'hanzo-console',
    redirectUri: 'https://console.hanzo.ai/auth/iam/callback',
    state: 'xyz',
  })
  assert.equal(calls[0]!.body.type, 'code')
  assert.match(calls[0]!.url, /type=code/)
  assert.equal('organization' in calls[0]!.body, false)
})

// Signup MUST still carry a concrete org — you cannot create a user in "no org".
test('signup STILL sends organization (unchanged — create needs a concrete org)', async () => {
  const { calls, fetchImpl } = capturingFetch()
  const client = createAuthClient({ tenant: tenant(), fetchImpl })
  await client.signup({
    email: 'new@hanzo.ai',
    password: 'pw',
    clientId: 'hanzo-console',
    application: 'hanzo-console',
    organization: 'hanzo',
  })
  assert.equal(calls[0]!.body.organization, 'hanzo')
})

// REGRESSION (the `hanzo-iam does not exist` social-login bug): an IAM
// app-provider LINK can carry an outer `name` that is NOT the provider record's
// name (some seeds label it `<org>-iam`). The provider's real identity is the
// nested `provider.name` the backend resolves on the social hop. getAppLogin
// MUST surface the inner record name (`provider-github`), never the outer label,
// or SocialButtons posts `provider=<org>-iam` and the backend 400s.
function appLoginFetch(payload: unknown): typeof fetch {
  return async () =>
    new Response(JSON.stringify({ status: 'ok', data: payload }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
}

test('getAppLogin uses the nested provider record name, not the outer link label', async () => {
  const fetchImpl = appLoginFetch({
    name: 'hanzo-console',
    organization: 'hanzo',
    providers: [
      {
        // Outer link label — a real-world seed set this to the per-app default.
        name: 'hanzo-iam',
        canSignIn: true,
        canSignUp: true,
        // Nested provider RECORD — the true identity + creds.
        provider: { name: 'provider-github', type: 'GitHub', clientId: 'Iv23li_real', scopes: '' },
      },
    ],
  })
  const client = createAuthClient({ tenant: tenant(), fetchImpl })
  const app = await client.getAppLogin('hanzo-console')
  assert.ok(app, 'app login resolved')
  assert.equal(app!.providers.length, 1)
  const gh = app!.providers[0]!
  assert.equal(gh.name, 'provider-github', 'provider name comes from the nested record')
  assert.equal(gh.key, 'github', 'key strips the provider- prefix')
  assert.equal(gh.type, 'GitHub')
  assert.equal(gh.configured, true, 'a real (non-placeholder) clientId is configured')
})

// The social code exchange must reuse the provider's REGISTERED callback host
// (oauthCallbackOrigin), not the brand host (publicOrigin). IAM forwards this
// redirect_uri verbatim to the provider's token endpoint, which requires it to
// match the authorize hop or the exchange fails `invalid_grant`. When a brand
// portal (hanzo.id) shares the iam.hanzo.ai OAuth client these two differ.
test('providerLogin posts redirectUri from oauthCallbackOrigin (matches the hop), with the single provider + code', async () => {
  const { calls, fetchImpl } = capturingFetch()
  const client = createAuthClient({
    tenant: tenant({ publicOrigin: 'https://hanzo.id', oauthCallbackOrigin: 'https://iam.hanzo.ai' }),
    fetchImpl,
  })
  const r = await client.providerLogin({
    application: 'hanzo-console',
    provider: 'provider-google',
    code: 'goog_code_xyz',
    oidcQuery:
      '?client_id=hanzo-console&redirect_uri=https%3A%2F%2Fconsole.hanzo.ai%2Fauth%2Fiam%2Fcallback&response_type=code&scope=openid&state=rp1',
    method: 'signin',
  })
  assert.equal(calls.length, 1)
  assert.equal(
    calls[0]!.body.redirectUri,
    'https://iam.hanzo.ai/callback',
    'redirect_uri derives from oauthCallbackOrigin (the hop), never publicOrigin',
  )
  assert.equal(calls[0]!.body.provider, 'provider-google')
  assert.equal(calls[0]!.body.code, 'goog_code_xyz')
  // The upstream OIDC params ride the query so IAM continues the original authorize.
  assert.match(calls[0]!.url, /client_id=hanzo-console/)
  assert.match(calls[0]!.url, /state=rp1/)
  // parseLoginResponse builds the app redirect from the minted code + the
  // original OIDC redirect_uri/state (the same shape as login/silentLogin).
  assert.equal(r.redirectUrl, 'https://console.hanzo.ai/auth/iam/callback?code=AUTHCODE&state=rp1')
})

// When there is NO nested record (degenerate seed), fall back to the outer label
// so the provider is still surfaced rather than dropped.
test('getAppLogin falls back to the outer name when no nested provider record', async () => {
  const fetchImpl = appLoginFetch({
    name: 'hanzo-console',
    organization: 'hanzo',
    providers: [{ name: 'provider-google', canSignIn: true, canSignUp: true, provider: null }],
  })
  const client = createAuthClient({ tenant: tenant(), fetchImpl })
  const app = await client.getAppLogin('hanzo-console')
  assert.ok(app)
  assert.equal(app!.providers[0]!.name, 'provider-google')
})

// TRUE SSO — the silent leg. silentLogin carries NO credentials: IAM mints the
// code from the existing issuer session (cookie sent via credentials:include).
// It builds the redirect back to the app from the minted code + state. The mint
// runs ONLY when the ambient session's org matches the app's org (same-org SSO,
// the common case: a hanzo session signing into a hanzo app).
test('silentLogin (same-org session) mints the code and redirects, carrying NO credentials', async () => {
  const { calls, fetchImpl } = routingFetch({ appOrg: 'hanzo', sessionOwner: 'hanzo' })
  const client = createAuthClient({ tenant: tenant(), fetchImpl })

  const r = await client.silentLogin({
    clientId: 'hanzo-console',
    application: 'hanzo-console',
    redirectUri: 'https://console.hanzo.ai/auth/iam/callback',
    state: 'st1',
    codeChallenge: 'chal',
  })

  // The mint leg (POST /v1/iam/login, type=code) ran after the org gate passed.
  const mint = calls.find((c) => c.body.type === 'code')
  assert.ok(mint, 'mint leg ran for a same-org session')
  // No credentials of any kind — this is session-only.
  assert.equal('username' in mint!.body, false, 'no username in silent login')
  assert.equal('password' in mint!.body, false, 'no password in silent login')
  assert.equal('provider' in mint!.body, false, 'no provider hop in silent login')
  assert.equal(mint!.body.application, 'hanzo-console')
  // OAuth params ride the query so IAM mints a code for the right client + PKCE.
  assert.match(mint!.url, /clientId=hanzo-console/)
  assert.match(mint!.url, /code_challenge=chal/)
  // The mint returns data:'AUTHCODE' -> a fully-formed app redirect.
  assert.equal(
    r.redirectUrl,
    'https://console.hanzo.ai/auth/iam/callback?code=AUTHCODE&state=st1',
  )
})

// THE ADMIN-GUARD FIX: silent SSO must NOT reuse a session that belongs to a
// DIFFERENT org than the app being signed into. An operator with an ambient
// hanzo/* session hitting the admin-guard (org=admin) must fall through to the
// interactive form (which authenticates in the admin org and resolves the
// admin/* identity) — NOT silently mint a code from the hanzo session (which
// would confer owner=hanzo and shadow the fix). No mint leg runs; no redirect.
test('silentLogin (cross-org session) does NOT mint — falls back to the form', async () => {
  const { calls, fetchImpl } = routingFetch({ appOrg: 'admin', sessionOwner: 'hanzo' })
  const client = createAuthClient({ tenant: tenant(), fetchImpl })

  const r = await client.silentLogin({
    clientId: 'hanzo-admin-guard',
    application: 'hanzo-admin-guard',
    redirectUri: 'https://admin.hanzo.ai/__guard/callback',
    state: 'st1',
    codeChallenge: 'chal',
  })

  assert.equal(r.redirectUrl, undefined, 'no silent redirect for a cross-org session')
  assert.equal(calls.some((c) => c.body.type === 'code'), false, 'the mint leg must NOT run')
})

// Same-org SSO still holds when BOTH are the admin org: an operator already
// signed in as admin/* silently re-enters the admin console.
test('silentLogin (same admin-org session) mints for the admin-guard', async () => {
  const { calls, fetchImpl } = routingFetch({ appOrg: 'admin', sessionOwner: 'admin' })
  const client = createAuthClient({ tenant: tenant(), fetchImpl })
  const r = await client.silentLogin({
    clientId: 'hanzo-admin-guard',
    application: 'hanzo-admin-guard',
    redirectUri: 'https://admin.hanzo.ai/__guard/callback',
    state: 'st1',
  })
  assert.ok(calls.find((c) => c.body.type === 'code'), 'mint leg ran for a same-org admin session')
  assert.equal(r.redirectUrl, 'https://admin.hanzo.ai/__guard/callback?code=AUTHCODE&state=st1')
})

// No live session: silentLogin returns an empty response (no mint) so Login.tsx
// falls back to the interactive form (never a dead end).
test('silentLogin returns empty (no mint) when there is no session (form fallback)', async () => {
  const { calls, fetchImpl } = routingFetch({ appOrg: 'hanzo', sessionOwner: null })
  const client = createAuthClient({ tenant: tenant(), fetchImpl })
  const r = await client.silentLogin({
    clientId: 'hanzo-console',
    application: 'hanzo-console',
    redirectUri: 'https://console.hanzo.ai/auth/iam/callback',
  })
  assert.equal(r.redirectUrl, undefined)
  assert.equal(calls.some((c) => c.body.type === 'code'), false, 'no mint without a session')
})

// ── Device-authorization approval (RFC 8628) ─────────────────────────────────
// approveDevice rides the issuer SESSION (like silentLogin): NO credentials in
// the body, `type:device` + the userCode IAM keys its DeviceAuthMap on, plus the
// tenant application/organization for the app lookup. On {status:ok} the device
// code is approved (UserSignIn=true) and the CLI's token poll succeeds.
test('approveDevice posts type=device + normalized userCode + tenant app/org, NO credentials', async () => {
  const { calls, fetchImpl } = capturingFetch()
  const client = createAuthClient({ tenant: tenant(), fetchImpl })

  const r = await client.approveDevice('K7M4P2QH')

  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.body.type, 'device')
  assert.equal(calls[0]!.body.userCode, 'K7M4P2QH')
  assert.equal(calls[0]!.body.application, 'hanzo-console')
  assert.equal(calls[0]!.body.organization, 'hanzo')
  // Session-only: never any credentials in a device approval.
  assert.equal('username' in calls[0]!.body, false)
  assert.equal('password' in calls[0]!.body, false)
  assert.equal('provider' in calls[0]!.body, false)
  assert.match(calls[0]!.url, /type=device/)
  assert.equal(r.ok, true)
})

// IAM mints codes from an UPPERCASE unambiguous alphabet ([A-HJ-NP-Z2-9]); a
// human may transcribe them lower-cased or with stray spaces/dashes. Normalize
// TO uppercase so the lookup matches — case-insensitive entry, exact-match send.
test('approveDevice uppercases and strips spaces/dashes before sending', async () => {
  const { calls, fetchImpl } = capturingFetch()
  const client = createAuthClient({ tenant: tenant(), fetchImpl })
  await client.approveDevice('  k7m4-p2qh ')
  assert.equal(calls[0]!.body.userCode, 'K7M4P2QH')
})

// An empty/blank code never hits the network — fail fast with a clear message.
test('approveDevice rejects an empty code without calling fetch', async () => {
  const { calls, fetchImpl } = capturingFetch()
  const client = createAuthClient({ tenant: tenant(), fetchImpl })
  const r = await client.approveDevice('   ')
  assert.equal(calls.length, 0)
  assert.equal(r.ok, false)
  assert.ok(r.error)
})

// The IAM error message (e.g. "UserCode Expired") is surfaced verbatim.
test('approveDevice surfaces the IAM error message', async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ status: 'error', msg: 'UserCode Expired' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  const client = createAuthClient({ tenant: tenant(), fetchImpl })
  const r = await client.approveDevice('K7M4P2QH')
  assert.equal(r.ok, false)
  assert.equal(r.error, 'UserCode Expired')
})

// Consent branch: {status:ok, data:{required:true}} → {ok:false, required:true}
// so the page can render consent instead of treating it as success or a dead end.
test('approveDevice maps the consent-required branch to { required: true }', async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ status: 'ok', data: { required: true } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  const client = createAuthClient({ tenant: tenant(), fetchImpl })
  const r = await client.approveDevice('K7M4P2QH')
  assert.equal(r.ok, false)
  assert.equal(r.required, true)
  assert.equal(r.error, undefined)
})

// getAppLogin's redirectUri is validated by IAM against the app's REGISTERED
// list. A cross-app SSO read (the console's `hanzo-cloud` viewed from hanzo.id)
// MUST send the downstream app's OWN redirect_uri — the portal's `/callback` is
// not in that app's list, so hardcoding it makes IAM drop the response and no
// social buttons resolve. Absent, it defaults to the portal's own callback.
test('getAppLogin sends the passed redirect_uri, and defaults to the portal callback when omitted', async () => {
  const urls: string[] = []
  const fetchImpl: typeof fetch = async (input) => {
    urls.push(typeof input === 'string' ? input : input.toString())
    return new Response(
      JSON.stringify({ status: 'ok', data: { name: 'hanzo-cloud', organization: 'hanzo', providers: [] } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }
  const client = createAuthClient({ tenant: tenant(), fetchImpl })

  // Cross-app read: the console's registered redirect_uri rides through verbatim.
  await client.getAppLogin('hanzo-cloud', 'https://console.hanzo.ai/auth/callback')
  const u1 = new URL(urls[0]!)
  assert.equal(u1.searchParams.get('clientId'), 'hanzo-cloud')
  assert.equal(u1.searchParams.get('redirectUri'), 'https://console.hanzo.ai/auth/callback')

  // Bare/own read: no redirect_uri → default to the portal's own /callback.
  await client.getAppLogin('hanzo-id')
  const u2 = new URL(urls[1]!)
  assert.equal(u2.searchParams.get('redirectUri'), 'https://hanzo.id/callback')
})
