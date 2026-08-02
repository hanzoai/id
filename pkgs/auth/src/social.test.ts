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
import { resolveOrg } from '@hanzo/id-shared/org'
import { buildProviderAuthUrl, isHoppableProvider, matchProviderHint } from './social.ts'

// The ONE origin the shared social OAuth clients have registered: the IAM
// backend's. Verified live against accounts.google.com — client
// `113591532635-…apps.googleusercontent.com` accepts this and nothing else;
// every other value, `https://hanzo.id/callback` included, is
// `Error 400: redirect_uri_mismatch`.
const CALLBACK_ORIGIN = 'https://iam.hanzo.ai'
// The browser origin the SPA runs on. It is NOT a registered redirect URI and
// must never appear in a redirect_uri — it is here to be asserted AGAINST.
const BROWSER_ORIGIN = 'https://hanzo.id'
// The original OIDC authorize query the portal was bounced here with.
const SEARCH = '?client_id=hanzo-id&redirect_uri=https%3A%2F%2Fhanzo.id%2Fcallback&response_type=code&scope=openid&state=rp123'

test('GitHub hop builds the correct endpoint, client_id, redirect_uri, and scope', () => {
  const url = buildProviderAuthUrl(
    { application: 'hanzo-id', providerName: 'provider-github', type: 'GitHub', clientId: 'gh_real_123' },
    CALLBACK_ORIGIN,
    SEARCH,
  )!
  assert.ok(url.startsWith('https://github.com/login/oauth/authorize?'))
  assert.ok(url.includes('client_id=gh_real_123'))
  // This assertion used to read `redirect_uri=https://hanzo.id/callback`, under
  // the comment "No callbackOrigin → defaults to the browser origin" — it pinned
  // the defect as the contract. The browser origin is not registered anywhere;
  // the redirect_uri is the callback origin the caller passes, and only that.
  assert.ok(url.includes('redirect_uri=https://iam.hanzo.ai/callback'))
  assert.ok(!url.includes(BROWSER_ORIGIN + '/callback'))
  assert.ok(url.includes('scope=user:email+read:user')) // GitHub default
  assert.ok(url.includes('response_type=code'))
})

test('GitLab hop builds the correct endpoint, client_id, redirect_uri, and scope', () => {
  const url = buildProviderAuthUrl(
    { application: 'hanzo-id', providerName: 'provider-gitlab', type: 'GitLab', clientId: 'gl_real_5a68' },
    CALLBACK_ORIGIN,
    SEARCH,
  )!
  assert.ok(url.startsWith('https://gitlab.com/oauth/authorize?'))
  assert.ok(url.includes('client_id=gl_real_5a68'))
  assert.ok(url.includes('redirect_uri=https://iam.hanzo.ai/callback'))
  assert.ok(url.includes('scope=read_user')) // GitLab identity read
  assert.ok(url.includes('response_type=code'))
})

test('the redirect_uri is the registered callback origin — the browser origin is not an input', () => {
  // The shared OAuth client is registered against iam.hanzo.ai/callback, so the
  // hop must return there even though the SPA runs on hanzo.id — otherwise the
  // provider rejects the redirect_uri (verified live: Google accepts ONLY
  // https://iam.hanzo.ai/callback for this client).
  const url = buildProviderAuthUrl(
    { application: 'hanzo-id', providerName: 'provider-google', type: 'Google', clientId: 'goog_1' },
    CALLBACK_ORIGIN,
    SEARCH,
  )!
  assert.ok(url.includes('redirect_uri=https://iam.hanzo.ai/callback'))
  assert.ok(!url.includes('redirect_uri=https://hanzo.id/callback'))
  // The upstream query names hanzo.id as the APP's redirect_uri and rides along
  // inside `state`; that is the app's business and must not leak into the
  // provider's redirect_uri.
  assert.equal(new URL(url).searchParams.get('redirect_uri'), 'https://iam.hanzo.ai/callback')
})

test('an empty callbackOrigin THROWS — it never falls back to the browser origin', () => {
  // The P0 shape: the org catalog did not load, so nothing supplies a registered
  // origin. The old signature defaulted to `window.location.origin` and shipped a
  // URL that could only fail at Google. Refusing here is the whole fix — the
  // caller can say "social sign-in is not configured", which is true and
  // actionable, instead of the user meeting `redirect_uri_mismatch`.
  assert.throws(
    () =>
      buildProviderAuthUrl(
        { application: 'hanzo-id', providerName: 'provider-google', type: 'Google', clientId: 'goog_1' },
        '',
        SEARCH,
      ),
    /oauthCallbackOrigin/,
  )
})

test('state base64-encodes the original OIDC query + application/provider/method (round-trips)', () => {
  const url = buildProviderAuthUrl(
    { application: 'hanzo-id', providerName: 'provider-github', type: 'GitHub', clientId: 'gh_real_123', method: 'signup' },
    CALLBACK_ORIGIN,
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
    CALLBACK_ORIGIN,
    searchWithHint,
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
    CALLBACK_ORIGIN,
    SEARCH,
  )!
  assert.ok(g.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'))
  assert.ok(g.includes('scope=profile+email'))

  const custom = buildProviderAuthUrl(
    { application: 'hanzo-id', providerName: 'provider-github', type: 'GitHub', clientId: 'gh_1', scopes: 'repo+user' },
    CALLBACK_ORIGIN,
    SEARCH,
  )!
  assert.ok(custom.includes('scope=repo+user'))
})

test('an unconfigured (empty clientId) or unknown provider type yields no URL', () => {
  // Benign, expected states — a provider we do not render — so `null`, not a
  // throw. The throw is reserved for the misconfiguration above.
  assert.equal(buildProviderAuthUrl({ application: 'a', providerName: 'p', type: 'GitHub', clientId: '' }, CALLBACK_ORIGIN, SEARCH), null)
  assert.equal(buildProviderAuthUrl({ application: 'a', providerName: 'p', type: 'Mystery', clientId: 'x' }, CALLBACK_ORIGIN, SEARCH), null)
})

/**
 * THE P0 REGRESSION, end to end over the real resolver.
 *
 * Google's OAuth client for Hanzo accepts exactly ONE redirect_uri —
 * `https://iam.hanzo.ai/callback` — and hanzo.id's live `/config.json` says so
 * (`"hanzo.id": {…,"oauthCallbackOrigin":"https://iam.hanzo.ai",…}`). What
 * shipped sent `https://hanzo.id/callback`, so every "Continue with Google" on
 * hanzo.id/signup, console.hanzo.ai and hanzo.app died at
 * `Error 400: redirect_uri_mismatch`.
 *
 * This drives the ACTUAL chain — catalog entry → resolveOrg → buildProviderAuthUrl
 * — because every link of it was individually "correct" while the composition was
 * broken. Testing the builder alone is what let this ship.
 */
test('P0: the Google URL for the hanzo.id org carries iam.hanzo.ai/callback, never the browser origin', () => {
  // Verbatim from the live https://hanzo.id/config.json catalog.
  const catalog = {
    'hanzo.id': {
      orgId: 'hanzo',
      clientId: 'hanzo-console',
      appName: 'hanzo-console',
      oauthCallbackOrigin: 'https://iam.hanzo.ai',
      brandUrl: 'https://cdn.jsdelivr.net/npm/@hanzo/brand@latest/brand.json',
    },
  }
  const org = resolveOrg('hanzo.id', { catalog })
  assert.equal(org.oauthCallbackOrigin, 'https://iam.hanzo.ai')
  // The catalog is also what names the IAM application, so the state stops
  // carrying `application=hanzo-id` (the built-in default that won when the
  // catalog failed to load) and carries the app the catalog declares.
  assert.equal(org.appName, 'hanzo-console')

  const url = buildProviderAuthUrl(
    { application: org.appName, providerName: 'provider-google', type: 'Google', clientId: 'goog_1' },
    org.oauthCallbackOrigin!,
    SEARCH,
  )!
  assert.ok(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'))
  assert.equal(new URL(url).searchParams.get('redirect_uri'), 'https://iam.hanzo.ai/callback')
  // The exact string Google refuses. Not present anywhere in the authorize URL.
  assert.ok(!url.includes('redirect_uri=https://hanzo.id/callback'))
  const decoded = Buffer.from(new URL(url).searchParams.get('state')!, 'base64').toString('utf8')
  assert.ok(decoded.includes('application=hanzo-console'))
  assert.ok(!decoded.includes('application=hanzo-id'))
})

test('P0: with NO catalog, hanzo.id refuses the hop rather than emitting the broken redirect_uri', () => {
  // The deployed failure mode exactly: `/config.json` answered 200 but the SPA
  // read a key the runtime does not serve, so `resolveOrg` ran with an empty
  // catalog and the built-in hanzo.id entry won. It carries no
  // oauthCallbackOrigin — and the resolver used to invent one from publicOrigin,
  // which is how `https://hanzo.id/callback` reached Google. Now the value stays
  // unset and the hop refuses.
  const org = resolveOrg('hanzo.id')
  assert.equal(org.oauthCallbackOrigin, undefined)
  assert.notEqual(org.oauthCallbackOrigin, org.publicOrigin)
  assert.throws(
    () =>
      buildProviderAuthUrl(
        { application: org.appName, providerName: 'provider-google', type: 'Google', clientId: 'goog_1' },
        org.oauthCallbackOrigin ?? '',
        SEARCH,
      ),
    /oauthCallbackOrigin/,
  )
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
