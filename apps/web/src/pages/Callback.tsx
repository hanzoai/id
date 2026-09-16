import { useEffect, useState } from 'react'
import type { Brand, Org } from '@hanzo/id-shared'
import { attachParkedWallet, createAuthClient, createIam } from '@hanzo/id-auth'
import { BrandFooter } from '../components/BrandFooter'

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
 *
 * A RETURN THAT CANNOT BE COMPLETED RESTARTS THE SIGN-IN, and does not report it.
 * One failure here is ordinary rather than exceptional: arriving with a `state`
 * this origin holds no transaction for. It happens with nothing broken — an old
 * link carrying `?code=&state=` is followed a second time, the attempt began in
 * another browser profile or a private window, or site data was cleared in
 * between. The SDK is right to refuse it (`@hanzo/iam`'s own test: "rejects a
 * callback with no stored transaction — no soft-skip of the state check"),
 * because the alternative is dropping the CSRF check that state IS.
 *
 * What was wrong was the answer. The page caught every failure alike and printed
 * the SDK's sentence, so a recoverable return became a dead end: the only
 * instruction it gave — restart sign-in — was the one thing it offered no way to
 * do. Now the query is dropped, because the query is precisely what cannot be
 * completed, and the portal's own login page begins a fresh transaction.
 *
 * ONCE. A restart that cannot succeed must not become a loop, so the attempt is
 * marked and a second arrival shows the error and stops. `post_login_redirect`
 * is deliberately left in place: where the person was going is still true, and
 * the fresh sign-in should still land them there.
 */
/**
 * restartedKey marks that this browser has already been sent back to sign in for
 * an uncompletable return. Session-scoped: the condition it guards against is a
 * stale URL, and a new tab deserves its own chance rather than inheriting one.
 */
const restartedKey = 'hanzo_id_callback_restarted'

/**
 * stale says the failure is a return that cannot be completed HERE, rather than
 * a sign-in that went wrong. It matches on the SDK's own sentence because that
 * phrasing is the contract `@hanzo/iam` tests itself against; a missing code is
 * the same fact arriving with less detail (someone opened this page directly).
 */
function stale(message: string): boolean {
  return /state mismatch|no stored transaction|missing code/i.test(message)
}

export function Callback({ org, brand }: { org: Org; brand: Brand }) {
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const iam = createIam(org)
    iam
      .handleCallback(window.location.href)
      .then(async (tok) => {
        sessionStorage.removeItem(restartedKey)
        // A wallet refused before this sign-in for having no account attaches to
        // the account that just signed in through a provider.
        await attachParkedWallet(createAuthClient({ org }))
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
      .catch((e) => {
        const message = String(e)
        if (stale(message) && !sessionStorage.getItem(restartedKey)) {
          sessionStorage.setItem(restartedKey, '1')
          window.location.replace('/login')
          return
        }
        setError(message)
      })
  }, [org])

  return (
    <div className="hanzo-id-page hanzo-id-callback">
      <main>
        {error ? <p role="alert" className="hanzo-id-error">{error}</p> : <p>Completing sign-in…</p>}
      </main>
      <BrandFooter brand={brand} org={org} />
    </div>
  )
}
