/**
 * Provider-hop URL builder tests — pure, no network. Run with:
 *   pnpm --filter @hanzo/id-auth test
 *
 * Verifies the URL + base64 state match the Hanzo-IAM (Casdoor) `getAuthUrl`
 * contract so the backend `/callback` exchange accepts the return. The
 * end-to-end OAuth round-trip still needs live verification once real provider
 * creds are seeded — but the URL/state construction is locked down here.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildProviderAuthUrl, isHoppableProvider } from './social.ts'

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
  assert.equal(isHoppableProvider('Google'), true)
  assert.equal(isHoppableProvider('Web3Onboard'), false)
})
