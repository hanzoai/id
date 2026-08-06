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
 * The order sign-in options are offered in — the ONE place the sequence is
 * declared.
 *
 * IAM decides WHICH providers an app has (`get-app-login`); this list decides
 * the order the user meets them in. That split is why the order is a client
 * concern: reordering is a presentation change and needs no provider record, no
 * org `defaultProviders` edit, and no deploy of IAM.
 *
 * Google leads because it is the account the most people are already signed in
 * to in the browser, so it is the shortest path to a session — the same reason
 * `onetap.ts` offers that account before anything is clicked. The two git
 * forges stay adjacent, and the wallet is last: it is the only option that needs
 * something installed.
 */
export const PROVIDER_ORDER = ['google', 'github', 'gitlab', 'web3'] as const

/**
 * The providers to render, in {@link PROVIDER_ORDER}, keeping only those the
 * app actually offers. Order comes from the declaration above, never from the
 * order IAM happened to return or from a sort in the renderer — one sequence,
 * one place, so what ships is what is written here.
 */
export function orderProviders(available: ReadonlySet<string> | ReadonlyMap<string, unknown> | Record<string, unknown>): string[] {
  const has =
    available instanceof Set || available instanceof Map
      ? (k: string) => available.has(k)
      : (k: string) => Object.prototype.hasOwnProperty.call(available, k)
  return PROVIDER_ORDER.filter(has)
}

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
