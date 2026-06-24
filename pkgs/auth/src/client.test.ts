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
