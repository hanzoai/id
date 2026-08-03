import { useEffect, useState } from 'react'
import type { BrandContract, OrgConfig } from '@hanzo/id-shared'
import { createIam } from '@hanzo/id-auth'
import { BrandHeader } from '../components/BrandHeader'

/**
 * OAuth/OIDC callback — the portal's OWN PKCE return, and only that.
 *
 * One kind of return lands here: an IAM authorization code for a flow this
 * portal started (password, wallet, or a federated provider begun through
 * `signinRedirect`). The `@hanzo/iam` SDK's `handleCallback` completes it,
 * reading back the exact PKCE verifier and state it stored.
 *
 * There is no second, social-specific case. A federated sign-in returns from the
 * IdP to IAM's OWN callback (`/v1/iam/oauth/callback`), which does the code
 * exchange server-side and sends the browser back here with an ordinary IAM code
 * — indistinguishable from any other. The page used to carry a branch that
 * decoded a base64 provider `state` and posted the raw IdP code back to IAM; no
 * endpoint ever accepted that, and nothing can produce that state any more.
 *
 * Routing after the exchange:
 *   - A non-OIDC "come back here" target left in `post_login_redirect` (device
 *     approval) → forward tokens there.
 *   - A bare portal sign-in → `/onboarding`.
 *
 * An app that sent the user here for a code never reaches this page at all: that
 * flow re-enters IAM's authorize endpoint and IAM redirects straight to the app.
 */
export function Callback({ org, brand }: { org: OrgConfig; brand: BrandContract }) {
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const iam = createIam(org)
    iam
      .handleCallback(window.location.href)
      .then((tok) => {
        const target = sessionStorage.getItem('post_login_redirect')
        sessionStorage.removeItem('post_login_redirect')
        if (target) {
          // Forward tokens to the page that sent the user to sign in.
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
  }, [org])

  return (
    <div className="hanzo-id-page hanzo-id-callback">
      <BrandHeader brand={brand} />
      <main>
        {error ? <p role="alert" className="hanzo-id-error">{error}</p> : <p>Completing sign-in…</p>}
      </main>
    </div>
  )
}
