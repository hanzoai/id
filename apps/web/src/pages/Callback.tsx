import { useEffect, useState } from 'react'
import type { BrandContract, TenantConfig } from '@hanzo/id-shared'
import { createIam } from '@hanzo/id-auth'
import { BrandHeader } from '../components/BrandHeader'

/**
 * OAuth/OIDC callback.
 *
 * Social + Web3 sign-in is driven by the `@hanzo/iam` SDK's `signinRedirect`
 * (in `SocialButtons`), so the callback completes with the same SDK's
 * `handleCallback` — it reads back the exact PKCE verifier/state the SDK
 * stored, exchanges the code at the token endpoint, and persists the tokens
 * in session storage. One client, one way (`createIam`).
 *
 * Routing after exchange:
 *   - A downstream app that initiated the flow left its target in
 *     `post_login_redirect`; we forward the tokens there.
 *   - A bare portal sign-in (the user came straight to the portal) has no
 *     such target → land on `/onboarding`, which reads the freshly stored
 *     token back through the same SDK client.
 */
export function Callback({ tenant, brand }: { tenant: TenantConfig; brand: BrandContract }) {
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
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
