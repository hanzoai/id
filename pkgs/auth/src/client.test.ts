import { test } from 'node:test'
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

// THE FIX: with loginOrg unset, the portal must NOT pin the brand org — it omits
// `organization` so IAM resolves the user cross-org (a global admin → the admin
// org / full session; a brand user → their own org). Pinning `hanzo` here is the
// live bug that truncates a global admin to one org.
test('login OMITS organization when loginOrg is unset (org-agnostic resolution)', async () => {
  const { calls, fetchImpl } = capturingFetch()
  const client = createAuthClient({ tenant: tenant(), fetchImpl })

  await client.login({
    identifier: 'z@hanzo.ai',
    password: 'pw',
    clientId: 'hanzo-console',
    application: 'hanzo-console',
    // organization intentionally not provided (LoginForm passes tenant.loginOrg)
  })

  assert.equal(calls.length, 1)
  assert.equal(
    'organization' in calls[0]!.body,
    false,
    'organization must be absent from the body so IAM runs cross-org resolution',
  )
  // The identity + app still ride the request.
  assert.equal(calls[0]!.body.username, 'z@hanzo.ai')
  assert.equal(calls[0]!.body.application, 'hanzo-console')
})

// An empty-string org is treated the same as unset (defensive: a catalog might
// emit "").
test('login OMITS organization when it is an empty string', async () => {
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

// REGRESSION (the `hanzo-iam does not exist` social-login bug): a Casdoor
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
  assert.equal(r.redirectUrl, 'AUTHCODE')
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
// It builds the redirect back to the app from the minted code + state.
test('silentLogin posts NO credentials and redirects with the minted code', async () => {
  const { calls, fetchImpl } = capturingFetch()
  const client = createAuthClient({ tenant: tenant(), fetchImpl })

  const r = await client.silentLogin({
    clientId: 'hanzo-console',
    application: 'hanzo-console',
    redirectUri: 'https://console.hanzo.ai/auth/iam/callback',
    state: 'st1',
    codeChallenge: 'chal',
  })

  assert.equal(calls.length, 1)
  // No credentials of any kind — this is session-only.
  assert.equal('username' in calls[0]!.body, false, 'no username in silent login')
  assert.equal('password' in calls[0]!.body, false, 'no password in silent login')
  assert.equal('provider' in calls[0]!.body, false, 'no provider hop in silent login')
  // The body carries the code intent + the target application only.
  assert.equal(calls[0]!.body.type, 'code')
  assert.equal(calls[0]!.body.application, 'hanzo-console')
  // OAuth params ride the query so IAM mints a code for the right client + PKCE.
  assert.match(calls[0]!.url, /clientId=hanzo-console/)
  assert.match(calls[0]!.url, /code_challenge=chal/)
  // The capturing fetch returns data:'AUTHCODE' -> a fully-formed app redirect.
  assert.equal(
    r.redirectUrl,
    'https://console.hanzo.ai/auth/iam/callback?code=AUTHCODE&state=st1',
  )
})

// No live session: IAM answers status:error -> silentLogin surfaces { error }
// so Login.tsx falls back to the interactive form (never a dead end).
test('silentLogin returns { error } when there is no session (form fallback)', async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ status: 'error', msg: 'please sign in first' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  const client = createAuthClient({ tenant: tenant(), fetchImpl })
  const r = await client.silentLogin({
    clientId: 'hanzo-console',
    application: 'hanzo-console',
    redirectUri: 'https://console.hanzo.ai/auth/iam/callback',
  })
  assert.equal(r.redirectUrl, undefined)
  assert.equal(r.error, 'please sign in first')
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
