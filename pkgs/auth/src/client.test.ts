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

// An IAM double for silent SSO that enforces the SERVER's real tenant rule, so
// these tests pin the behaviour the production endpoint was measured to have
// rather than a client-side restatement of it. From internal/oidc/mint.go, the
// one mint path:
//
//     if org != app.Organization && !app.IsShared && app.OrgChoiceMode == "" {
//         return "", errors.New("the user is not permitted to sign in to this application")
//     }
//
// `sessionOwner: null` models no live session, which IAM answers `login_required`.
function iamFetch(opts: {
  appOrg: string
  sessionOwner: string | null
  /** Set on apps whose users found their own orgs (hanzo-app: "create"). */
  orgChoiceMode?: string
  isShared?: boolean
  code?: string
}) {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const json = (payload: unknown) =>
    new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString()
    let body: Record<string, unknown> = {}
    if (init?.body && typeof init.body === 'string') body = JSON.parse(init.body)
    calls.push({ url, body })
    if (url.includes('/get-app-login')) {
      return json({
        status: 'ok',
        data: {
          name: 'app',
          organization: opts.appOrg,
          orgChoiceMode: opts.orgChoiceMode ?? '',
          isShared: opts.isShared ?? false,
          providers: [],
        },
      })
    }
    if (!opts.sessionOwner) {
      return json({ status: 'error', msg: 'please sign in first', code: 'login_required' })
    }
    if (opts.sessionOwner !== opts.appOrg && !opts.isShared && !opts.orgChoiceMode) {
      return json({ status: 'error', msg: 'the user is not permitted to sign in to this application' })
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

// A username is IAM's value to mint. This posted `email.split('@')[0]`, which is
// not a username: `alice+hanzo` fails IAM's charset outright, and a local part
// somebody already holds comes back "username already exists" — about a field the
// signup form does not have, so there is nothing the person can do. Send the
// address; IAM derives the name and deduplicates it against the directory the
// browser cannot see.
test('signup posts the ADDRESS and lets IAM mint the username', async () => {
  const { calls, fetchImpl } = capturingFetch()
  const client = createAuthClient({ org: org(), fetchImpl })
  await client.signup({
    email: 'alice+hanzo@gmail.com',
    password: 'correct horse battery staple',
    clientId: 'hanzo-app',
    application: 'hanzo-app',
    organization: 'hanzo',
  })
  assert.equal(calls[0]!.body.email, 'alice+hanzo@gmail.com')
  assert.equal('username' in calls[0]!.body, false)
  // Nor a display name guessed from the same local part — IAM falls back to the
  // name it minted, which is the one that is actually usable.
  assert.equal('name' in calls[0]!.body, false)
  // `confirm` was posted for its name too; signupForm has no such field, so it was
  // decoded into nothing. A form that reads as enforced and is not is the defect.
  assert.equal('confirm' in calls[0]!.body, false)
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

// Federation is entered by NAMING the provider on IAM's own authorize endpoint.
// The `provider` field has always been on OAuthAuthorizeRequest; `authorize`
// never emitted it, which is why social sign-in had no server side at all.
test('authorize emits the provider record name, so IAM federates instead of showing its login', () => {
  const client = createAuthClient({ org: org({ iamUrl: 'https://hanzo.id' }) })
  const url = new URL(
    client.authorize({
      clientId: 'hanzo-console',
      redirectUri: 'https://hanzo.id/callback',
      state: 'rp1',
      codeChallenge: 'C1',
      codeChallengeMethod: 'S256',
      provider: 'provider-github',
    }),
  )
  assert.equal(url.pathname, '/v1/iam/oauth/authorize')
  // The RECORD name, never the bare key: federationProvider matches
  // ProviderItem.Name exactly (live, `provider=github` is refused).
  assert.equal(url.searchParams.get('provider'), 'provider-github')
  // The app's own request is what IAM binds the minted code to.
  assert.equal(url.searchParams.get('client_id'), 'hanzo-console')
  assert.equal(url.searchParams.get('redirect_uri'), 'https://hanzo.id/callback')
  assert.equal(url.searchParams.get('code_challenge'), 'C1')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
})

test('authorize without a provider stays the ordinary hosted-login request', () => {
  const client = createAuthClient({ org: org({ iamUrl: 'https://hanzo.id' }) })
  const url = new URL(
    client.authorize({ clientId: 'hanzo-console', redirectUri: 'https://hanzo.id/callback', state: 'rp1' }),
  )
  assert.equal(url.searchParams.get('provider'), null)
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
  const { calls, fetchImpl } = iamFetch({ appOrg: 'hanzo', sessionOwner: 'hanzo' })
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

// THE ADMIN-GUARD INVARIANT: silent SSO must not confer a code on a session
// belonging to a DIFFERENT org than a tenant-locked app. An operator holding an
// ambient hanzo/* session who hits the admin-guard (org=admin, not shared, no
// org-choice) must land on the interactive form — which authenticates in the
// admin org and resolves the admin/* identity — never on a code minted from the
// hanzo session. Unchanged; it is IAM that refuses, which is why it also holds
// for front doors this client knows nothing about.
test('silentLogin (cross-org session, tenant-locked app) does NOT mint — falls back to the form', async () => {
  const { fetchImpl } = iamFetch({ appOrg: 'admin', sessionOwner: 'hanzo' })
  const client = createAuthClient({ org: org(), fetchImpl })

  const r = await client.silentLogin({
    clientId: 'hanzo-admin-guard',
    application: 'hanzo-admin-guard',
    redirectUri: 'https://admin.hanzo.ai/__guard/callback',
    state: 'st1',
    codeChallenge: 'chal',
  })

  assert.equal(r.redirectUrl, undefined, 'no silent redirect for a cross-org session')
  assert.match(r.error ?? '', /not permitted to sign in/)
})

// THE REGRESSION THIS FIXES. Onboarding MOVES the caller into the org it just
// created, so a customer who finished onboarding has a session owner that is
// their OWN org while `hanzo-app` remains org=hanzo. The app carries
// `orgChoiceMode: "create"` for exactly this reason and IAM mints happily; the
// client used to refuse first, and the customer met a sign-in form on the way to
// pay.hanzo.ai seconds after signing in.
test('silentLogin mints for a post-onboarding session whose org differs (orgChoiceMode app)', async () => {
  const { calls, fetchImpl } = iamFetch({
    appOrg: 'hanzo',
    sessionOwner: 'acme-inc',
    orgChoiceMode: 'create',
  })
  const client = createAuthClient({ org: org(), fetchImpl })

  const r = await client.silentLogin({
    clientId: 'hanzo-app',
    application: 'hanzo-app',
    redirectUri: 'https://pay.hanzo.ai/auth/callback',
    state: 'st1',
    codeChallenge: 'chal',
  })

  assert.equal(
    r.redirectUrl,
    'https://pay.hanzo.ai/auth/callback?code=AUTHCODE&state=st1',
    'a moved-org session still signs in silently',
  )
  // And it costs exactly one request: the mint. No pre-flight reads.
  assert.equal(calls.length, 1, 'silent SSO is a single round trip')
  assert.equal(calls[0]!.body.type, 'code')
})

// Same-org SSO still holds when BOTH are the admin org: an operator already
// signed in as admin/* silently re-enters the admin console.
test('silentLogin (same admin-org session) mints for the admin-guard', async () => {
  const { calls, fetchImpl } = iamFetch({ appOrg: 'admin', sessionOwner: 'admin' })
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

// No live session: IAM answers `login_required`, silentLogin surfaces it as an
// error and Login.tsx falls back to the interactive form (never a dead end).
test('silentLogin does not redirect when there is no session (form fallback)', async () => {
  const { fetchImpl } = iamFetch({ appOrg: 'hanzo', sessionOwner: null })
  const client = createAuthClient({ org: org(), fetchImpl })
  const r = await client.silentLogin({
    clientId: 'hanzo-console',
    application: 'hanzo-console',
    redirectUri: 'https://console.hanzo.ai/auth/iam/callback',
  })
  assert.equal(r.redirectUrl, undefined)
  assert.match(r.error ?? '', /sign in first/)
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

// Sign-out has to clear THIS BROWSER, not just end the session at the IdP.
//
// The bug: Portal navigated straight to client.logout(), which builds the
// RP-initiated logout URL and nothing else. The server really did revoke the
// token (measured against prod: the leftover token 401s "invalid or revoked"),
// but every `hanzo_iam_*` key survived — so the token STRING outlived the
// session it named, and anything treating that key's presence as "signed in"
// still believed you were.
test('signOut clears every hanzo_iam_* key, in BOTH storages, and returns the IdP URL', () => {
  const store = () => {
    const m = new Map<string, string>()
    return {
      get length() { return m.size },
      key: (i: number) => [...m.keys()][i] ?? null,
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
      clear: () => m.clear(),
      _keys: () => [...m.keys()],
    }
  }
  const ss = store(), ls = store()
  const g = globalThis as Record<string, unknown>
  const [ps, pl] = [g.sessionStorage, g.localStorage]
  g.sessionStorage = ss
  g.localStorage = ls
  try {
    // Three of the SDK's keys, plus a neighbour that must SURVIVE — otherwise
    // "it cleared everything" would pass this test just as well.
    for (const s of [ss, ls]) {
      s.setItem('hanzo_iam_access_token', 'x')
      s.setItem('hanzo_iam_expires_at', 'x')
      s.setItem('hanzo_iam_code_verifier:abc', 'x')
      s.setItem('theme', 'dark')
    }
    const client = createAuthClient({
      org: { orgId: 'hanzo', iamUrl: 'https://hanzo.id', iamIssuer: 'https://hanzo.id',
             clientId: 'hanzo-console', appName: 'hanzo-console',
             publicOrigin: 'https://hanzo.id', brandPackage: '@hanzo/brand' } as never,
    })
    const url = client.signOut('https://hanzo.id/login')

    assert.deepEqual(ss._keys(), ['theme'], 'sessionStorage')
    assert.deepEqual(ls._keys(), ['theme'], 'localStorage')
    assert.match(url, /\/v1\/iam\/oauth\/logout\?/)
    assert.match(url, /post_logout_redirect_uri=https%3A%2F%2Fhanzo\.id%2Flogin/)
  } finally {
    g.sessionStorage = ps
    g.localStorage = pl
  }
})

// The OTP send is the one call in this client that is NOT JSON.
//
// IAM reads `dest`, `type` and `applicationId` with fiber's FormValue, which parses
// urlencoded and multipart bodies and never a JSON one — so posting JSON left every
// field unread and IAM answered "missing parameter: type". Measured on production
// against the exact body this client used to send.
test('sendCode posts form fields IAM can actually read', async () => {
  const seen: { url: string; type: string | null; body: string }[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    seen.push({
      url: input.toString(),
      type: new Headers(init?.headers).get('Content-Type'),
      body: String(init?.body ?? ''),
    })
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
  }
  const client = createAuthClient({ org: org(), fetchImpl })

  const res = await client.sendCode({
    dest: '+14155550134',
    channel: 'phone',
    application: 'admin/hanzo-console',
  })

  assert.equal(res.ok, true)
  assert.equal(seen.length, 1)
  assert.equal(seen[0]!.type, 'application/x-www-form-urlencoded')
  const fields = new URLSearchParams(seen[0]!.body)
  assert.equal(fields.get('dest'), '+14155550134')
  assert.equal(fields.get('type'), 'phone', 'the channel is IAM\'s `type` field')
  assert.equal(fields.get('applicationId'), 'admin/hanzo-console')
  // v1 accepted `method`/`checkUser`; iam reads neither, so they were noise on the
  // wire that made the shape look like it needed them.
  assert.equal(fields.has('method'), false)
  assert.equal(fields.has('checkUser'), false)
})

// A refusal has to reach the person as the server's own sentence.
//
// The early `if (!res.ok) return {error: 'HTTP ' + res.status}` ran BEFORE the body
// was parsed, so IAM's explanation was read and thrown away: the recovery page
// rendered the literal string "HTTP 400" to someone trying to get back into their
// account.
test('sendCode surfaces the reason IAM gave, not its status code', async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        status: 'error',
        msg: 'verification codes cannot be delivered: no notify service is configured',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  const client = createAuthClient({ org: org(), fetchImpl })

  const res = await client.sendCode({
    dest: 'someone@hanzo.ai',
    channel: 'email',
    application: 'admin/hanzo-console',
  })

  assert.equal(res.ok, false)
  assert.equal(res.error, 'verification codes cannot be delivered: no notify service is configured')
})

// One credential per request, and which one IS the choice of arm: IAM reads a code
// where a password goes and never reaches the password check when one is present.
//
// `signinMethod: 'Password'` used to ride along on every login. IAM's loginForm has
// no such field, so the decoder dropped it — and leaving it there told the next
// person a code sign-in needs some other value in it, which is exactly the wrong
// thing to believe about an arm chosen by which credential is non-empty.
test('login sends the credential it was given and never names the arm', async () => {
  const { calls, fetchImpl } = capturingFetch()
  const client = createAuthClient({ org: org(), fetchImpl })

  await client.login({
    identifier: '+14155550134',
    code: '123456',
    clientId: 'hanzo-console',
    application: 'hanzo-console',
    organization: 'hanzo',
  })
  assert.equal(calls[0]!.body.code, '123456')
  assert.equal('password' in calls[0]!.body, false, 'a code login carries no password field')
  assert.equal('signinMethod' in calls[0]!.body, false)
  // The identifier goes on the wire exactly as typed — a phone number needs no
  // client-side normalization, because IAM's own lookup normalizes it and a second
  // normalizer is how two spellings of one number stop agreeing.
  assert.equal(calls[0]!.body.username, '+14155550134')

  await client.login({
    identifier: 'z@hanzo.ai',
    password: 'pw',
    clientId: 'hanzo-console',
    application: 'hanzo-console',
    organization: 'hanzo',
  })
  assert.equal(calls[1]!.body.password, 'pw')
  assert.equal('code' in calls[1]!.body, false, 'a password login carries no code field')
})

// An invitation is about joining an ORGANIZATION, and the onboarding screen already
// says so ("Joining an existing org happens by invitation"). It was also being
// posted to /v1/iam/signup as `invitationCode`, where signupForm has no such field:
// the code was decoded into nothing, so an `?invite=` link validated nothing,
// recorded nothing, and accepted any string at all. Nothing may post it back until
// the door that can enforce it is the one asking.
test('signup posts no invitation code — IAM has no field for one', async () => {
  const { calls, fetchImpl } = capturingFetch()
  const client = createAuthClient({ org: org(), fetchImpl })
  await client.signup({
    email: 'invitee@hanzo.ai',
    password: 'correct horse battery staple',
    clientId: 'hanzo-app',
    application: 'hanzo-app',
    organization: 'hanzo',
  })
  assert.equal('invitationCode' in calls[0]!.body, false)
})
