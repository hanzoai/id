/**
 * Provider-hop URL builder tests — pure, no network. Run with:
 *   pnpm --filter @hanzo/id-auth test
 *
 * Verifies the URL + base64 state match the Hanzo IAM `getAuthUrl`
 * contract so the backend `/callback` exchange accepts the return. The
 * end-to-end OAuth round-trip still needs live verification once real provider
 * creds are seeded — but the URL/state construction is locked down here.
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { buildProviderAuthUrl, isHoppableProvider, matchProviderHint } from './social.ts'

const ORIGIN = 'https://hanzo.id'
// The original OIDC authorize query the portal was bounced here with.
const SEARCH = '?client_id=hanzo-id&redirect_uri=https%3A%2F%2Fhanzo.id%2Fcallback&response_type=code&scope=openid&state=rp123'

test('GitHub hop builds the correct endpoint, client_id, redirect_uri, and scope', () => {
  const url = buildProviderAuthUrl(
    { application: 'hanzo-id', providerName: 'provider-github', type: 'GitHub', clientId: 'gh_real_123' },
    ORIGIN,
    SEARCH,
  )!
  assert.ok(url.startsWith('https://github.com/login/oauth/authorize?'))
  assert.ok(url.includes('client_id=gh_real_123'))
  // No callbackOrigin → defaults to the browser origin.
  assert.ok(url.includes('redirect_uri=https://hanzo.id/callback'))
  assert.ok(url.includes('scope=user:email+read:user')) // GitHub default
  assert.ok(url.includes('response_type=code'))
})

test('GitLab hop builds the correct endpoint, client_id, redirect_uri, and scope', () => {
  const url = buildProviderAuthUrl(
    { application: 'hanzo-id', providerName: 'provider-gitlab', type: 'GitLab', clientId: 'gl_real_5a68' },
    ORIGIN,
    SEARCH,
  )!
  assert.ok(url.startsWith('https://gitlab.com/oauth/authorize?'))
  assert.ok(url.includes('client_id=gl_real_5a68'))
  assert.ok(url.includes('redirect_uri=https://hanzo.id/callback'))
  assert.ok(url.includes('scope=read_user')) // GitLab identity read
  assert.ok(url.includes('response_type=code'))
})

test('the registered callback origin overrides the browser origin in redirect_uri', () => {
  // The shared OAuth client is registered against iam.hanzo.ai/callback, so the
  // hop must return there even though the SPA runs on hanzo.id — otherwise the
  // provider rejects the redirect_uri (verified live: Google accepts ONLY
  // https://iam.hanzo.ai/callback for this client).
  const url = buildProviderAuthUrl(
    { application: 'hanzo-id', providerName: 'provider-google', type: 'Google', clientId: 'goog_1' },
    ORIGIN,
    SEARCH,
    'https://iam.hanzo.ai',
  )!
  assert.ok(url.includes('redirect_uri=https://iam.hanzo.ai/callback'))
  assert.ok(!url.includes('redirect_uri=https://hanzo.id/callback'))
})

test('state base64-encodes the original OIDC query + application/provider/method (round-trips)', () => {
  const url = buildProviderAuthUrl(
    { application: 'hanzo-id', providerName: 'provider-github', type: 'GitHub', clientId: 'gh_real_123', method: 'signup' },
    ORIGIN,
    SEARCH,
  )!
  const state = new URL(url).searchParams.get('state')!
  const decoded = Buffer.from(state, 'base64').toString('utf8')
  // The RP's original request survives so the backend can complete it.
  assert.ok(decoded.includes('client_id=hanzo-id'))
  assert.ok(decoded.includes('state=rp123'))
  assert.ok(decoded.includes('application=hanzo-id'))
  assert.ok(decoded.includes('provider=provider-github'))
  assert.ok(decoded.includes('method=signup'))
})

test('a pre-existing provider= in the upstream query is stripped — state carries exactly ONE provider', () => {
  // The console→hanzo.id SSO SDK appends `provider=hanzo-iam` (its per-org IDP
  // hint) to the upstream authorize query. The hop appends the REAL social
  // provider; the upstream one MUST be stripped, because `Callback` recovers the
  // provider with `URLSearchParams.get` (the FIRST match) — two `provider=`
  // params would make it post `hanzo-iam`, which the IAM backend rejects.
  const searchWithHint =
    '?client_id=hanzo-console&redirect_uri=https%3A%2F%2Fiam.hanzo.ai%2Fcallback&response_type=code&scope=openid&state=rp123&provider=hanzo-iam'
  const url = buildProviderAuthUrl(
    { application: 'hanzo-console', providerName: 'provider-google', type: 'Google', clientId: 'goog_1' },
    ORIGIN,
    searchWithHint,
    'https://iam.hanzo.ai',
  )!
  const state = new URL(url).searchParams.get('state')!
  const decoded = Buffer.from(state, 'base64').toString('utf8')
  const params = new URLSearchParams(decoded.replace(/^\?/, ''))
  // Exactly one provider, and it is the real social one (not the upstream hint).
  assert.deepEqual(params.getAll('provider'), ['provider-google'])
  assert.equal(params.get('provider'), 'provider-google') // FIRST match = the social provider
  assert.ok(!decoded.includes('hanzo-iam')) // the upstream hint is gone entirely
  // The rest of the upstream OIDC request is preserved so the backend completes it.
  assert.ok(decoded.includes('client_id=hanzo-console'))
  assert.ok(decoded.includes('state=rp123'))
})

test('Google uses its own endpoint + scope; a custom provider scope overrides', () => {
  const g = buildProviderAuthUrl(
    { application: 'hanzo-id', providerName: 'provider-google', type: 'Google', clientId: 'goog_1' },
    ORIGIN,
    SEARCH,
  )!
  assert.ok(g.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'))
  assert.ok(g.includes('scope=profile+email'))

  const custom = buildProviderAuthUrl(
    { application: 'hanzo-id', providerName: 'provider-github', type: 'GitHub', clientId: 'gh_1', scopes: 'repo+user' },
    ORIGIN,
    SEARCH,
  )!
  assert.ok(custom.includes('scope=repo+user'))
})

test('an unconfigured (empty clientId) or unknown provider type yields no URL', () => {
  assert.equal(buildProviderAuthUrl({ application: 'a', providerName: 'p', type: 'GitHub', clientId: '' }, ORIGIN, SEARCH), null)
  assert.equal(buildProviderAuthUrl({ application: 'a', providerName: 'p', type: 'Mystery', clientId: 'x' }, ORIGIN, SEARCH), null)
})

test('isHoppableProvider knows the OAuth set, not wallet', () => {
  assert.equal(isHoppableProvider('GitHub'), true)
  assert.equal(isHoppableProvider('GitLab'), true)
  assert.equal(isHoppableProvider('Google'), true)
  assert.equal(isHoppableProvider('Web3Onboard'), false)
})

test('matchProviderHint resolves the console hint, the bare key, and case, else undefined', () => {
  const providers = [
    { name: 'provider-github', key: 'github' },
    { name: 'provider-google', key: 'google' },
  ]
  // The console sends the IAM record name verbatim (`provider-github`).
  assert.equal(matchProviderHint(providers, 'provider-github')?.key, 'github')
  assert.equal(matchProviderHint(providers, 'provider-google')?.key, 'google')
  // The bare key and any case also resolve, so the two sides need no shared constant.
  assert.equal(matchProviderHint(providers, 'github')?.key, 'github')
  assert.equal(matchProviderHint(providers, 'GitHub')?.key, 'github')
  // A hint for a provider this app doesn't offer, or an empty hint, matches nothing.
  assert.equal(matchProviderHint(providers, 'provider-apple'), undefined)
  assert.equal(matchProviderHint(providers, ''), undefined)
})
