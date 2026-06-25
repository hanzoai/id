/**
 * Social provider redirect — the "hop" that sends the browser to GitHub /
 * Google / … to start an OAuth login, replicating the Hanzo-IAM (Casdoor)
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
 *   state = btoa(`${window.location.search}&application=${app}&provider=`
 *           `${providerName}&method=${method}`)   // base64 of the ORIGINAL
 *           // OIDC query + app/provider/method, so the backend recovers the
 *           // original request when the provider returns to /callback.
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
  /** "signin" (default) or "signup" — passed through to the backend. */
  readonly method?: 'signin' | 'signup'
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
  const method = p.method ?? 'signin'
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
  const state = btoa(`${baseSearch}&application=${encodeURIComponent(p.application)}&provider=${encodeURIComponent(p.providerName)}&method=${method}`)
  return `${info.endpoint}?client_id=${p.clientId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code&state=${state}`
}

/** True when this portal knows how to start an OAuth hop for the given type. */
export function isHoppableProvider(type: string): boolean {
  return type in AUTH_INFO
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
