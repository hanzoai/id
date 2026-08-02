import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createAuthClient } from './client.ts'
import type { OrgConfig } from '@hanzo/id-shared'

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

function org(overrides: Partial<OrgConfig> = {}): OrgConfig {
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
  const client = createAuthClient({ org: org(), fetchImpl })

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
  const client = createAuthClient({ org: org(), fetchImpl })
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
  const client = createAuthClient({ org: org(), fetchImpl })
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
  const client = createAuthClient({ org: org(), fetchImpl })
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
  const client = createAuthClient({ org: org(), fetchImpl })
  await client.signup({
    email: 'new@hanzo.ai',
    password: 'pw',
    clientId: 'hanzo-console',
    application: 'hanzo-console',
    organization: 'hanzo',
  })
  assert.equal(calls[0]!.body.organization, 'hanzo')
})

// REGRESSION (every new customer was stranded on the portal): IAM's signup is
// CREATE-ONLY — it sets no session and mints no code. Signup must therefore end
// in a real sign-in, or the app that sent the user waits forever for a code.
test('signup COMPLETES the OIDC request — create, then sign in, then redirect back with the code', async () => {
  const { calls, fetchImpl } = capturingFetch()
  const client = createAuthClient({ org: org(), fetchImpl })
  const res = await client.signup({
    email: 'new@hanzo.ai',
    password: 'pw',
    clientId: 'hanzo-app',
    application: 'hanzo-app',
    organization: 'hanzo',
    redirectUri: 'https://hanzo.app/auth/callback',
    state: 'xyz',
    codeChallenge: 'CHALLENGE',
    codeChallengeMethod: 'S256',
  })

  // Two legs, in order: create the row, then authenticate it.
  assert.equal(calls.length, 2)
  assert.match(calls[0]!.url, /\/v1\/iam\/signup/)
  assert.match(calls[1]!.url, /\/v1\/iam\/login/)

  // The sign-in leg carries the downstream request, so the code is PKCE-bound.
  assert.match(calls[1]!.url, /code_challenge=CHALLENGE/)
  assert.match(calls[1]!.url, /code_challenge_method=S256/)
  assert.match(calls[1]!.url, /type=code/)
  assert.equal(calls[1]!.body.username, 'new@hanzo.ai')

  // And the caller is handed a destination BACK AT THE APP — never the portal's
  // own /onboarding, which is where the create-only response used to land.
  assert.equal(res.redirectUrl, 'https://hanzo.app/auth/callback?code=AUTHCODE&state=xyz')
})

// `autoSignin` was posted for its name and dropped on the floor: the Go
// signupForm has no such field, so it never signed anyone in. Do not post a flag
// the server does not read — it is what made this look like it worked.
test('signup does NOT post autoSignin (IAM has no such field)', async () => {
  const { calls, fetchImpl } = capturingFetch()
  const client = createAuthClient({ org: org(), fetchImpl })
  await client.signup({
    email: 'new@hanzo.ai',
    password: 'pw',
    clientId: 'hanzo-app',
    application: 'hanzo-app',
    organization: 'hanzo',
  })
  assert.equal('autoSignin' in calls[0]!.body, false)
})

// IAM refuses with HTTP 200 + status:"error", so the status code proves nothing.
// A refused create must surface the reason and must NOT go on to try a login.
test('a refused signup surfaces the reason and never attempts a sign-in', async () => {
  const seen: string[] = []
  const fetchImpl: typeof fetch = async (input) => {
    seen.push(typeof input === 'string' ? input : input.toString())
    return new Response(JSON.stringify({ status: 'error', msg: 'email already exists', data: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const client = createAuthClient({ org: org(), fetchImpl })
  const res = await client.signup({
    email: 'taken@hanzo.ai',
    password: 'pw',
    clientId: 'hanzo-app',
    application: 'hanzo-app',
    organization: 'hanzo',
    redirectUri: 'https://hanzo.app/auth/callback',
  })
  assert.equal(res.error, 'email already exists')
  assert.equal(res.redirectUrl, undefined)
  assert.equal(seen.length, 1)
  assert.match(seen[0]!, /\/v1\/iam\/signup/)
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
  const client = createAuthClient({ org: org(), fetchImpl })
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
    org: org({ publicOrigin: 'https://hanzo.id', oauthCallbackOrigin: 'https://iam.hanzo.ai' }),
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

// The other half of the same rule. This leg used to read
// `oauthCallbackOrigin ?? publicOrigin`, so an org with no declared callback
// origin posted the BRAND host — which IAM forwards verbatim to Google, which
// rejects it `invalid_grant`. Same invented value as the hop's, one leg later.
// There is nothing to substitute: refuse, and say which knob is missing.
test('providerLogin REFUSES when the org declares no oauthCallbackOrigin — it never posts publicOrigin', async () => {
  const { calls, fetchImpl } = capturingFetch()
  const client = createAuthClient({
    org: org({ publicOrigin: 'https://hanzo.id', oauthCallbackOrigin: undefined }),
    fetchImpl,
  })
  const r = await client.providerLogin({
    application: 'hanzo-console',
    provider: 'provider-google',
    code: 'goog_code_xyz',
    oidcQuery: '?client_id=hanzo-console&redirect_uri=https%3A%2F%2Fconsole.hanzo.ai%2Fauth%2Fiam%2Fcallback&state=rp1',
    method: 'signin',
  })
  assert.match(r.error ?? '', /oauthCallbackOrigin/)
  assert.equal(r.redirectUrl, undefined)
  assert.equal(calls.length, 0, 'no exchange is attempted with a redirect_uri the provider will reject')
})

// When there is NO nested record (degenerate seed), fall back to the outer label
// so the provider is still surfaced rather than dropped.
test('getAppLogin falls back to the outer name when no nested provider record', async () => {
  const fetchImpl = appLoginFetch({
    name: 'hanzo-console',
    organization: 'hanzo',
    providers: [{ name: 'provider-google', canSignIn: true, canSignUp: true, provider: null }],
  })
  const client = createAuthClient({ org: org(), fetchImpl })
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
  const client = createAuthClient({ org: org(), fetchImpl })

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
  const client = createAuthClient({ org: org(), fetchImpl })

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
  const client = createAuthClient({ org: org(), fetchImpl })
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
  const client = createAuthClient({ org: org(), fetchImpl })
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
// org application/organization for the app lookup. On {status:ok} the device
// code is approved (UserSignIn=true) and the CLI's token poll succeeds.
test('approveDevice posts type=device + normalized userCode + org app/org, NO credentials', async () => {
  const { calls, fetchImpl } = capturingFetch()
  const client = createAuthClient({ org: org(), fetchImpl })

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
  const client = createAuthClient({ org: org(), fetchImpl })
  await client.approveDevice('  k7m4-p2qh ')
  assert.equal(calls[0]!.body.userCode, 'K7M4P2QH')
})

// An empty/blank code never hits the network — fail fast with a clear message.
test('approveDevice rejects an empty code without calling fetch', async () => {
  const { calls, fetchImpl } = capturingFetch()
  const client = createAuthClient({ org: org(), fetchImpl })
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
  const client = createAuthClient({ org: org(), fetchImpl })
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
  const client = createAuthClient({ org: org(), fetchImpl })
  const r = await client.approveDevice('K7M4P2QH')
  assert.equal(r.ok, false)
  assert.equal(r.required, true)
  assert.equal(r.error, undefined)
})

// ── Which application is this code for? (deviceInfo) ─────────────────────────
// A one-call double for `POST /v1/iam/oauth/device/info`: records what the
// request actually was (URL, method, credentials, body) and answers with
// `payload`.
function deviceInfoFetch(payload: unknown) {
  const calls: {
    url: string
    method?: string
    credentials?: RequestCredentials
    body?: string
  }[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: typeof input === 'string' ? input : input.toString(),
      method: init?.method,
      credentials: init?.credentials,
      body: typeof init?.body === 'string' ? init.body : undefined,
    })
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return { calls, fetchImpl }
}

// THE REGRESSION THIS FILE EXISTS FOR. The approval page used to render
// `org.appName` — the PORTAL's own branding, the static `hanzo-console` this
// test's org() is configured with — so a device sign-in started by `hanzo-cli`
// was approved under a screen naming a different application. The name must come
// off the RESPONSE, which is the code's own application, and never off the org
// config; asserting both is what keeps the two from being confused again.
test('deviceInfo names the RESPONSE client, never the portal org appName', async () => {
  const { calls, fetchImpl } = deviceInfoFetch({
    status: 'ok',
    data: { clientId: 'hanzo-cli', displayName: 'Hanzo CLI' },
  })
  const cfg = org()
  const client = createAuthClient({ org: cfg, fetchImpl })

  const r = await client.deviceInfo('K7M4P2QH')

  assert.equal(r.ok, true)
  assert.equal(r.ok && r.clientId, 'hanzo-cli')
  assert.equal(r.ok && r.displayName, 'Hanzo CLI')
  // The portal is hanzo-console. Nothing about it may reach the result.
  assert.equal(cfg.appName, 'hanzo-console')
  assert.notEqual(r.ok && r.clientId, cfg.appName)
  assert.notEqual(r.ok && r.displayName, cfg.appName)

  // A session-cookie POST at the /v1/ device-info path. The user_code is the one
  // secret in this flow, so it rides the BODY: a request line is copied into
  // ingress and proxy access logs where a body is not, and this page ships
  // scrubUrl() precisely to keep the code out of URLs.
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.url, 'https://hanzo.id/v1/iam/oauth/device/info')
  assert.equal(calls[0]!.method, 'POST')
  assert.equal(calls[0]!.credentials, 'include')
  assert.equal(calls[0]!.body, JSON.stringify({ userCode: 'K7M4P2QH' }))
  assert.equal(calls[0]!.url.includes('K7M4P2QH'), false)
})

// Same normalization as the approval: a code transcribed lower-cased or with
// dashes must resolve to the same row IAM minted, or the page would refuse to
// name an application that is perfectly live.
test('deviceInfo uppercases and strips spaces/dashes into the body', async () => {
  const { calls, fetchImpl } = deviceInfoFetch({
    status: 'ok',
    data: { clientId: 'hanzo-cli', displayName: 'Hanzo CLI' },
  })
  const client = createAuthClient({ org: org(), fetchImpl })
  await client.deviceInfo('  k7m4-p2qh ')
  assert.equal(calls[0]!.url, 'https://hanzo.id/v1/iam/oauth/device/info')
  assert.equal(calls[0]!.body, JSON.stringify({ userCode: 'K7M4P2QH' }))
})

// An empty code names nothing and never hits the network.
test('deviceInfo rejects an empty code without calling fetch', async () => {
  const { calls, fetchImpl } = deviceInfoFetch({ status: 'ok', data: {} })
  const client = createAuthClient({ org: org(), fetchImpl })
  const r = await client.deviceInfo('   ')
  assert.equal(calls.length, 0)
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.loginRequired, undefined)
})

// IAM `CodeLoginRequired`: the session lapsed. Flagged separately from a refusal
// because the page's answer is to sign the human in and come back, not to give up.
test('deviceInfo flags login_required distinctly from a refusal', async () => {
  const { fetchImpl } = deviceInfoFetch({
    status: 'error',
    msg: 'please sign in first',
    code: 'login_required',
  })
  const client = createAuthClient({ org: org(), fetchImpl })
  const r = await client.deviceInfo('K7M4P2QH')
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.loginRequired, true)
  assert.equal(r.ok === false && r.error, 'please sign in first')
})

// The ONE opaque refusal IAM answers for unknown / expired / already-approved —
// surfaced verbatim, carrying no loginRequired, so the page shows it and offers
// no approval. Distinguishing those three would be an oracle for hunting the
// 40-bit user_code; the client must not invent a distinction either.
test('deviceInfo surfaces the opaque refusal verbatim and does not name an app', async () => {
  const { fetchImpl } = deviceInfoFetch({
    status: 'error',
    msg: 'the user code is invalid or expired',
  })
  const client = createAuthClient({ org: org(), fetchImpl })
  const r = await client.deviceInfo('K7M4P2QH')
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.error, 'the user code is invalid or expired')
  assert.equal(r.ok === false && r.loginRequired, undefined)
})

// The org-boundary refusal is a plain refusal too: surfaced, not special-cased.
test('deviceInfo surfaces the wrong-org refusal', async () => {
  const { fetchImpl } = deviceInfoFetch({
    status: 'error',
    msg: 'your organization may not approve this device sign-in',
  })
  const client = createAuthClient({ org: org(), fetchImpl })
  const r = await client.deviceInfo('K7M4P2QH')
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.error, 'your organization may not approve this device sign-in')
})

// An HTML error page from a proxy is not an application name. It must fail,
// never resolve to a blank or guessed one.
test('deviceInfo fails on a non-JSON response', async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response('<html>502 Bad Gateway</html>', {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    })
  const client = createAuthClient({ org: org(), fetchImpl })
  const r = await client.deviceInfo('K7M4P2QH')
  assert.equal(r.ok, false)
  assert.match(String(r.ok === false && r.error), /non-JSON/)
})

// A network failure resolves — never rejects — so the page renders the failure
// instead of tearing down on an unhandled rejection.
test('deviceInfo resolves an error when fetch throws', async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error('offline')
  }
  const client = createAuthClient({ org: org(), fetchImpl })
  const r = await client.deviceInfo('K7M4P2QH')
  assert.equal(r.ok, false)
  assert.match(String(r.ok === false && r.error), /offline/)
})

// A 200 that names no client is not a name. Falling back to ANY local string here
// is what produced the original defect, so an absent clientId is a failure.
test('deviceInfo refuses an ok response with no clientId', async () => {
  const { fetchImpl } = deviceInfoFetch({ status: 'ok', data: { displayName: 'Hanzo CLI' } })
  const client = createAuthClient({ org: org(), fetchImpl })
  const r = await client.deviceInfo('K7M4P2QH')
  assert.equal(r.ok, false)
})

// IAM already falls back to the app's name when DisplayName is empty; if one ever
// arrives blank anyway, the label is the server-confirmed clientId — never the portal's.
test('deviceInfo falls back to the confirmed clientId when displayName is empty', async () => {
  const { fetchImpl } = deviceInfoFetch({ status: 'ok', data: { clientId: 'hanzo-cli', displayName: '' } })
  const client = createAuthClient({ org: org(), fetchImpl })
  const r = await client.deviceInfo('K7M4P2QH')
  assert.equal(r.ok, true)
  assert.equal(r.ok && r.displayName, 'hanzo-cli')
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
  const client = createAuthClient({ org: org(), fetchImpl })

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
