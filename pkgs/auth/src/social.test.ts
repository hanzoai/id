/**
 * Federated sign-in — pure unit tests, no network. Run with:
 *   pnpm --filter @hanzo/id-auth test
 *
 * The browser's whole job in a federated sign-in is to name the provider on
 * IAM's authorize endpoint and, when an app sent the user here, to hand that
 * app's own request back unchanged so IAM mints the code against it. Those two
 * are what these tests pin; the IdP leg belongs to IAM and is not modelled here.
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { authorizeRequest, matchProviderHint } from './social.ts'

const PORTAL = 'hanzo-console'

test('an app-initiated request is recovered whole, so IAM binds the code to that app', () => {
  // What IAM forwards to the hosted login (authorizeForwardQuery) when an app
  // sends a user here for a code.
  const req = authorizeRequest(
    '?client_id=hanzo-app&redirect_uri=https%3A%2F%2Fhanzo.app%2Fcallback&response_type=code' +
      '&scope=openid+profile&state=rp123&nonce=n1&code_challenge=C1&code_challenge_method=S256',
    PORTAL,
  )!
  assert.equal(req.clientId, 'hanzo-app')
  assert.equal(req.redirectUri, 'https://hanzo.app/callback')
  assert.equal(req.state, 'rp123')
  assert.equal(req.scope, 'openid profile')
  assert.equal(req.nonce, 'n1')
  // Load-bearing: the code IAM mints is bound to the APP's challenge, so the
  // app's own callback completes the exchange with the verifier it kept.
  assert.equal(req.codeChallenge, 'C1')
  assert.equal(req.codeChallengeMethod, 'S256')
})

test('a bare portal sign-in has no app to return to', () => {
  // No redirect_uri → nothing to return a code to, so the portal starts its own
  // PKCE flow instead (the SDK owns the verifier; Callback reads it back).
  assert.equal(authorizeRequest('', PORTAL), null)
  assert.equal(authorizeRequest('?provider_hint=provider-github', PORTAL), null)
})

test('the portal client id is the fallback, never an override', () => {
  const own = authorizeRequest('?redirect_uri=https%3A%2F%2Fhanzo.id%2Fcallback', PORTAL)!
  assert.equal(own.clientId, PORTAL, 'no client_id on the query → the portal is the client')

  const app = authorizeRequest('?client_id=hanzo-app&redirect_uri=https%3A%2F%2Fhanzo.app%2Fcallback', PORTAL)!
  assert.equal(app.clientId, 'hanzo-app', "the app's own client_id wins — the code is minted for IT")
})

test('a leading ? is optional and absent params stay absent', () => {
  const withMark = authorizeRequest('?redirect_uri=https%3A%2F%2Fhanzo.id%2Fcallback', PORTAL)!
  const without = authorizeRequest('redirect_uri=https%3A%2F%2Fhanzo.id%2Fcallback', PORTAL)!
  assert.deepEqual(withMark, without)
  // Undefined, not '' — client.authorize omits a param it was not given, and an
  // empty code_challenge is not the same request as no code_challenge.
  assert.equal(withMark.codeChallenge, undefined)
  assert.equal(withMark.nonce, undefined)
  assert.equal(withMark.scope, undefined)
  assert.equal(withMark.state, '', 'state is always sent, empty when the app sent none')
})

test('only the two PKCE methods RFC 7636 defines are carried through', () => {
  const base = 'redirect_uri=https%3A%2F%2Fhanzo.id%2Fcallback&code_challenge=C1&code_challenge_method='
  assert.equal(authorizeRequest(base + 'S256', PORTAL)!.codeChallengeMethod, 'S256')
  assert.equal(authorizeRequest(base + 'plain', PORTAL)!.codeChallengeMethod, 'plain')
  // Anything else is dropped rather than forwarded, so client.authorize applies
  // its S256 default instead of asking IAM to honor a method it does not define.
  assert.equal(authorizeRequest(base + 'md5', PORTAL)!.codeChallengeMethod, undefined)
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
