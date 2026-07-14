/**
 * Social provider redirect — the "hop" that sends the browser to GitHub /
 * Google / … to start an OAuth login, replicating the Hanzo IAM
 * front-end `Provider.getAuthUrl` contract so the IAM backend's `/callback`
 * exchange accepts the return.
 *
 * Why this exists: the IAM backend's OIDC authorize endpoint, for an
 * unauthenticated request, 302s to its OWN login-page route (`/login/oauth/
 * authorize`) and expects the FRONT END to read `?provider=` and bounce to the
 * provider. We replaced that front end with this portal, so the portal must do
 * the bounce. `iam.signinRedirect({provider})` does NOT — it just re-enters the
 * authorize endpoint and loops.
 *
 * Contract (from `web/src/auth/Provider.tsx::getAuthUrl` + `Util.tsx::
 * getStateFromQueryParams` in the IAM fork):
 *   url   = `${endpoint}?client_id=${clientId}&redirect_uri=${origin}/callback`
 *           `&scope=${scope}&response_type=code&state=${state}`
 *   state = encodeState(`${window.location.search}&application=${app}&provider=`
 *           `${providerName}&method=${method}`)   // URL-SAFE base64 of the
 *           // ORIGINAL OIDC query + app/provider/method, so the backend recovers
 *           // the original request when the provider returns to /callback.
 *
 * Only the standard OAuth2 set is wired here (the providers a `-id` app
 * actually enables: github, google, +web3 handled elsewhere). Apple uses the
 * backend callback and is added when needed.
 *
 * NOTE: live-verify this end-to-end once real OAuth credentials are seeded —
 * it cannot be exercised while every provider carries placeholder creds (the
 * buttons are hidden until then; see SocialButtons + AppProvider.configured).
 */

/** Provider `type` → OAuth2 authorize endpoint + default scope (IAM `authInfo`). */
const AUTH_INFO: Record<string, { endpoint: string; scope: string }> = {
  GitHub: { endpoint: 'https://github.com/login/oauth/authorize', scope: 'user:email+read:user' },
  // Canonical Google OAuth2 authorize endpoint. (Google aliases the legacy
  // `/signin/oauth` path, but `/o/oauth2/v2/auth` is the documented, stable one.)
  Google: { endpoint: 'https://accounts.google.com/o/oauth2/v2/auth', scope: 'profile+email' },
}

export interface ProviderLoginParams {
  /** IAM application name the portal authenticates as (e.g. `hanzo-id`). */
  readonly application: string
  /** IAM provider record name, e.g. `provider-github`. */
  readonly providerName: string
  /** IAM provider `type`, e.g. `GitHub` / `Google` (selects the endpoint). */
  readonly type: string
  /** The provider's real OAuth client id (from `get-app-login`). */
  readonly clientId: string
  /** Override scope; falls back to the type default. */
  readonly scopes?: string
  /**
   * IAM social-auth method. Defaults to "signup" — the find-or-create-LOGIN
   * branch (IAM canonical). "signin" is the account-LINK branch and needs
   * an existing session, so it is NOT used for interactive provider sign-in.
   */
  readonly method?: 'signin' | 'signup'
}

/**
 * URL-safe base64 (RFC 4648 §5) for the round-tripped `state`.
 *
 * The provider reflects `state` back on a URL query string. Standard base64
 * (`btoa`) emits `+` `/` `=`, and on the return `URLSearchParams` turns `+`
 * into a space (then `atob` strips it) — silently CORRUPTING the encoded OIDC
 * request, including the `code_challenge`. A corrupted, non-empty challenge is
 * exactly what makes the app's later token exchange fail with
 * `invalid_grant: code_verifier does not match code_challenge`. Encoding the
 * state with the URL-safe alphabet (and decoding it the same way in `Callback`)
 * makes the round-trip byte-exact. The payload is ASCII (an OAuth query), so a
 * plain `btoa`/`atob` core is sufficient.
 */
export function encodeState(raw: string): string {
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Inverse of {@link encodeState}; tolerant of standard or URL-safe input. */
export function decodeState(state: string): string {
  let b64 = state.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4) b64 += '='
  return atob(b64)
}

/**
 * Build the provider authorize URL (pure; testable without navigating).
 *
 * `callbackOrigin` is the origin of the `/callback` that MUST be registered as
 * the provider's authorized redirect URI. The OAuth client (one per provider)
 * is registered against a SINGLE callback host — the IAM backend host
 * (`iam.hanzo.ai`) — shared across every brand portal, so the provider only
 * accepts that exact `redirect_uri`. Sending the browser's own origin (e.g.
 * `hanzo.id`) yields `redirect_uri_mismatch`. Callers pass the registered
 * origin; it defaults to `origin` for the single-host / local-dev case.
 *
 * `iam.hanzo.ai/callback` serves the SAME `@hanzo/id` SPA (the headless
 * `Callback` page — no login UI), which decodes the base64 `state` to recover
 * the original app's `redirect_uri`, exchanges the provider `code` at the IAM
 * backend, and forwards the browser back to the originating app.
 */
export function buildProviderAuthUrl(
  p: ProviderLoginParams,
  origin: string,
  search: string,
  callbackOrigin: string = origin,
): string | null {
  const info = AUTH_INFO[p.type]
  if (!info || !p.clientId) return null
  const scope = p.scopes && p.scopes.trim() !== '' ? p.scopes : info.scope
  const redirectUri = `${callbackOrigin}/callback`
  // IAM's social branch does FIND-OR-CREATE-LOGIN only under method `signup`
  // (the canonical IAM default — web `Util.tsx` getEvent → getAuthUrl(...,
  // "signup")). Any other value (incl. `signin`) takes the account-LINK branch,
  // which requires an EXISTING session and 400s a fresh "Continue with Google".
  const method = p.method ?? 'signup'
  // The console SSO SDK appends a unified `provider=<org>-iam` hint to the
  // upstream authorize query (`search`). We append the REAL social provider
  // below, so strip any pre-existing `provider=` first — otherwise the state
  // carries TWO `provider=` params and the /callback exchange resolves the
  // wrong one (`<org>-iam`, which IAM rejects). One provider, one source of
  // truth — don't rely on "backend reads the last param".
  const baseQ = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  baseQ.delete('provider')
  const baseSearch = `?${baseQ.toString()}`
  // Base64 of the original OIDC query + routing — the backend decodes this on
  // the /callback return to complete the original authorize request.
  const state = encodeState(`${baseSearch}&application=${encodeURIComponent(p.application)}&provider=${encodeURIComponent(p.providerName)}&method=${method}`)
  return `${info.endpoint}?client_id=${p.clientId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code&state=${state}`
}

/** True when this portal knows how to start an OAuth hop for the given type. */
export function isHoppableProvider(type: string): boolean {
  return type in AUTH_INFO
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

/**
 * Redirect the browser to the provider to begin login. No-op return on bad input.
 *
 * `callbackOrigin` (the provider's registered redirect host, e.g.
 * `https://iam.hanzo.ai`) defaults to the current origin when omitted.
 */
export function startProviderLogin(p: ProviderLoginParams, callbackOrigin?: string): void {
  if (typeof window === 'undefined') return
  const url = buildProviderAuthUrl(p, window.location.origin, window.location.search, callbackOrigin ?? window.location.origin)
  if (url) window.location.assign(url)
}
