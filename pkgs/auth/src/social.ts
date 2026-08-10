import type { OAuthAuthorizeRequest } from './types'

/**
 * Federated sign-in — the portal's half of IAM identity federation.
 *
 * IAM is the relying party; this SPA is not. `/v1/iam/oauth/authorize?provider=…`
 * IS the entry point: having already validated the client_id, the EXACT
 * redirect_uri and the PKCE policy, IAM stashes the app-leg request server-side,
 * sets a single-use browser-binding cookie and sends the browser to the IdP
 * (`internal/oidc/federation.go::beginFederation`). The IdP returns to IAM's own
 * fixed callback — `/v1/iam/oauth/callback`, never a route in this SPA — where
 * IAM, which holds the client SECRET a browser cannot, exchanges the code, links
 * or provisions the user, and mints an IAM authorization code bound to the
 * original PKCE challenge, redirect_uri and nonce. The ordinary code→token
 * exchange then completes unchanged.
 *
 * This file used to build the IdP URL here in the browser, replicating a contract
 * from an IAM fork whose front end no longer exists. Nothing could ever finish it:
 * the SPA has no client secret and IAM has no endpoint that exchanges a raw
 * provider code, so GitHub returned to `/callback` with a code nobody could spend
 * and the flow died there. The browser's only job is to NAME the provider.
 *
 * The name is the IAM provider RECORD name (`provider-github`), never the bare
 * key: `federationProvider` matches `ProviderItem.Name` exactly, and
 * `EnrichProviders` resolves that same name to the record, so the two are one
 * string by construction. Verified live — `provider=github` is refused with
 * "unknown or unavailable provider"; `provider=provider-github` redirects to
 * GitHub.
 */

/**
 * The authorize request this portal is standing in for, read from its own URL.
 *
 * When an app sends a user here for a code, IAM forwards that app's validated
 * request on the query (`authorizeForwardQuery`). Re-entering authorize with it —
 * plus `provider` — is what makes IAM mint the code against THAT app: its
 * client_id, its redirect_uri, its PKCE challenge. The browser is returned
 * straight to the app, so this portal's own `/callback` never runs and no token
 * is ever handed across on a URL.
 *
 * Null when there is no app to return to (a bare portal sign-in), which is the
 * signal to start the portal's own PKCE flow instead. Keyed on `redirect_uri`
 * because that is the one parameter that makes a request returnable — the same
 * condition the password path branches on (`Login.completeAfterAuth`).
 *
 * The result is an {@link OAuthAuthorizeRequest} because that is exactly what
 * `client.authorize` consumes: one type, read and written in one shape.
 */
export function authorizeRequest(search: string, clientId: string): OAuthAuthorizeRequest | null {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const redirectUri = q.get('redirect_uri')
  if (!redirectUri) return null
  const method = q.get('code_challenge_method')
  return {
    clientId: q.get('client_id') || clientId,
    redirectUri,
    state: q.get('state') ?? '',
    scope: q.get('scope') ?? undefined,
    nonce: q.get('nonce') ?? undefined,
    codeChallenge: q.get('code_challenge') ?? undefined,
    codeChallengeMethod: method === 'plain' || method === 'S256' ? method : undefined,
  }
}

/**
 * The order federated providers are offered in, most-used first.
 *
 * Order is PROVIDER POLICY, so it lives here beside the other provider policy
 * rather than in the component that happens to paint the buttons — and being a
 * value in a pure module, it is the only part of the button strip a test can
 * actually hold still. It had drifted before: an unexported constant inside the
 * component, covered by nothing.
 *
 * Google leads because it is the account most people arrive already signed into,
 * and the wallet trails because it is the specialist entry. A provider absent
 * from this list does not render at all, which is deliberate: a name here is the
 * statement that the portal knows how to draw and finish that provider's flow.
 */
// `phone` is last and is NOT a federated provider — it selects which identifier
// the credential form asks for. It lives in this order anyway because the order
// is the STRIP's, not the provider list's: the wallet is already here on the same
// terms (a capability, not a provider row), and a person reading a column of ways
// to sign in does not care which of them is an OAuth hop.
export const PROVIDER_ORDER = ['google', 'github', 'gitlab', 'web3', 'phone'] as const

/**
 * Resolve a `provider_hint` from the authorize query to one of the app's
 * configured providers. A client that already knows which provider the user
 * chose (the console passes `?provider_hint=provider-github` when a user clicks
 * "Continue with GitHub" over there) sends the hint so this portal launches that
 * provider straight away — no second button press, no bounce through a login
 * page. Accepts the IAM record name (`provider-github`), the normalized key
 * (`github`), or the record name with the `provider-` prefix stripped, so the
 * two sides agree without a shared constant. Returns undefined when nothing
 * matches (the caller falls back to the interactive form).
 */
export function matchProviderHint<P extends { name: string; key: string }>(
  providers: Iterable<P>,
  hint: string,
): P | undefined {
  const h = hint.trim().toLowerCase()
  if (h === '') return undefined
  const bare = h.replace(/^provider-/, '')
  for (const p of providers) {
    const name = p.name.toLowerCase()
    const key = p.key.toLowerCase()
    if (name === h || key === h || key === bare) return p
  }
  return undefined
}
