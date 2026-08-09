import { useState } from 'react'
import type { BrandContract } from '@hanzo/id-shared'
import { OTPForm, mfaChannelOf, MFA_TOTP, type AuthClient } from '@hanzo/id-auth'
import { BrandHeader } from '../components/BrandHeader'

/**
 * `/login/mfa` — the second factor for a sign-in that arrived through ANOTHER
 * identity provider.
 *
 * IAM owns this address (`internal/oidc/federation.go::PathMfaVerify`). When a
 * Google or GitHub sign-in resolves someone who owes a factor, the callback mints
 * NOTHING: it parks the whole authorize request in a single-use, subject-pinned
 * challenge, sets the challenge id as an httpOnly cookie, and sends the browser
 * here. This page is the only thing that can redeem that challenge — and it did
 * not exist, so the path fell through to the ordinary credential form and every
 * 2FA-enrolled person who signed in with Google hit a loop: no OTP field, nothing
 * posting the factor, the resume expiring unused, the app getting nothing.
 *
 * It knows nothing about the sign-in and needs to: the account, the client, the
 * redirect_uri and the PKCE challenge are all pinned server-side, so there is no
 * field here that could swap them. The answer IAM returns is the finished redirect
 * back to whichever app started this, which is why the page navigates rather than
 * deciding a destination of its own.
 */
export function Mfa({ client, brand }: { client: AuthClient; brand: BrandContract }) {
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(passcode: string) {
    setError(null)
    const res = await client.federationMfa({ mfaType: MFA_TOTP, passcode })
    if (res.redirectUrl) {
      window.location.href = res.redirectUrl
      return
    }
    // A wrong code SPENDS the challenge (IAM burns it on use), so the way back is
    // to start the sign-in again rather than to retype here.
    setError(res.error ?? 'the sign-in could not be completed')
  }

  return (
    <div className="hanzo-id-page hanzo-id-login">
      <BrandHeader brand={brand} />
      <main>
        <h1>Two-factor authentication</h1>
        <p className="lede">Enter the code from your authenticator app to finish signing in.</p>
        {error ? (
          <>
            <p role="alert" className="hanzo-id-error">{error}</p>
            <p className="hanzo-id-footer-links">
              <a href="/login">Start again</a>
            </p>
          </>
        ) : null}
        <OTPForm channel={mfaChannelOf(MFA_TOTP)} onSubmit={onSubmit} />
      </main>
    </div>
  )
}
