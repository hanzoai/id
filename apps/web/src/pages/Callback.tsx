import { useEffect, useState } from 'react'
import type { BrandContract, TenantConfig } from '@hanzo/id-shared'
import { createIam, createAuthClient, decodeState } from '@hanzo/id-auth'
import { BrandHeader } from '../components/BrandHeader'

/**
 * OAuth/OIDC callback.
 *
 * Two kinds of return land here:
 *   1. The portal's own OIDC PKCE return (password / SDK `signinRedirect`) —
 *      completed by the `@hanzo/iam` SDK's `handleCallback`, which reads back
 *      the exact PKCE verifier/state it stored.
 *   2. A SOCIAL provider return (GitHub/Google), where `social.ts` sent the
 *      user out with a base64 `state` that encodes the original authorize
 *      request. We detect that, exchange the provider `code` at the IAM backend
 *      (`client.providerLogin`), and follow the continue-URL it returns — which
 *      re-enters this callback as case (1). (Pending live verification; only
 *      reachable once real provider creds are seeded.)
 *
 * Routing after the OIDC exchange:
 *   - A downstream app left its target in `post_login_redirect` → forward tokens.
 *   - A bare portal sign-in → `/onboarding`.
 */

/** Decode a social-provider `state` (URL-safe base64 of the authorize query). */
function decodeProviderState(state: string | null): URLSearchParams | null {
  if (!state) return null
  try {
    const decoded = decodeState(state)
    const params = new URLSearchParams(decoded.replace(/^\?/, ''))
    // A provider-login state always carries application + provider markers.
    if (params.get('provider') && params.get('application')) return params
  } catch {
    // not base64 → an SDK/OIDC state, not a provider return
  }
  return null
}

export function Callback({ tenant, brand }: { tenant: TenantConfig; brand: BrandContract }) {
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const search = new URLSearchParams(window.location.search)
    const providerState = decodeProviderState(search.get('state'))

    // Case (2): social provider return → exchange the provider code, then follow
    // the continue-URL back into case (1).
    if (providerState && search.get('code')) {
      const client = createAuthClient({ tenant })
      const oidcQuery = decodeState(search.get('state')!)
      client
        .providerLogin({
          application: providerState.get('application') ?? '',
          provider: providerState.get('provider') ?? '',
          code: search.get('code') ?? '',
          oidcQuery,
          method: providerState.get('method') ?? 'signin',
        })
        .then((r) => {
          if (r.redirectUrl) window.location.replace(r.redirectUrl)
          else setError(r.error ?? 'Sign-in failed')
        })
        .catch((e) => setError(String(e)))
      return
    }

    // Case (1): the portal's own OIDC PKCE return.
    const iam = createIam(tenant)
    iam
      .handleCallback(window.location.href)
      .then((tok) => {
        const target = sessionStorage.getItem('post_login_redirect')
        sessionStorage.removeItem('post_login_redirect')
        if (target) {
          // Forward tokens to whichever app initiated this flow.
          const url = new URL(target, window.location.origin)
          url.searchParams.set('access_token', tok.accessToken)
          if (tok.refreshToken) url.searchParams.set('refresh_token', tok.refreshToken)
          if (tok.idToken) url.searchParams.set('id_token', tok.idToken)
          window.location.replace(url.toString())
          return
        }
        // Bare portal sign-in → onboarding.
        window.location.replace('/onboarding')
      })
      .catch((e) => setError(String(e)))
  }, [tenant])

  return (
    <div className="hanzo-id-page hanzo-id-callback">
      <BrandHeader brand={brand} />
      <main>
        {error ? <p role="alert" className="hanzo-id-error">{error}</p> : <p>Completing sign-in…</p>}
      </main>
    </div>
  )
}
