import { useEffect, useState } from 'react'
import type { BrandContract } from '@hanzo/id-shared'
import { SignupForm, SocialButtons, type AuthClient } from '@hanzo/id-auth'
import { BrandHeader } from '../components/BrandHeader'

export function Signup({ client, brand }: { client: AuthClient; brand: BrandContract }) {
  const sp = new URLSearchParams(window.location.search)
  const inviteCode = sp.get('invite') ?? undefined
  const clientIdOverride = sp.get('client_id') ?? undefined
  const redirectUri = sp.get('redirect_uri') ?? undefined
  // The same downstream OIDC request `Login` reads. Registration ends in a
  // sign-in, so it needs the whole request — not just the client and its
  // callback — or the minted code carries no PKCE binding and no state.
  const state = sp.get('state') ?? undefined
  const codeChallenge = sp.get('code_challenge') ?? undefined
  const codeChallengeMethod = (sp.get('code_challenge_method') as 'S256' | 'plain' | null) ?? undefined
  const nonce = sp.get('nonce') ?? undefined

  // Only ask for credentials an account can actually be made with. IAM refuses
  // signup on an app with `enableSignUp:false` — 48 of 51 hanzo applications
  // today — and it refuses at SUBMIT, so this page used to take an email and a
  // password and only then answer "the application does not allow to sign up
  // new account". The provider buttons dead-end the same way: federation
  // PROVISIONS a local user for a new identity, so a first-time GitHub sign-up
  // hits the same gate after a whole round trip through GitHub.
  //
  // `enableSignUp` is already on `AppLogin` and already fetched — SignupForm
  // reads the same row inside onSubmit. Reading it here instead is what turns
  // the refusal from a surprise into a state.
  //
  // It FAILS OPEN, deliberately: an unreadable app config renders the form, and
  // the server still refuses. This is honesty about a known answer, not a gate —
  // the gate is `internal/oidc/signup.go` and must stay the only one.
  const [open, setOpen] = useState(true)
  useEffect(() => {
    let cancelled = false
    client
      .getAppLogin(clientIdOverride, redirectUri)
      .then((app) => {
        if (!cancelled && app) setOpen(app.enableSignUp)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [client, clientIdOverride, redirectUri])

  if (!open) {
    return (
      <div className="hanzo-id-page hanzo-id-signup">
        <BrandHeader brand={brand} />
        <main>
          <h1>Create your {brand.name} account</h1>
          <p className="hanzo-id-info">
            This application does not accept new accounts. If you already have
            one, sign in below.
          </p>
          <p className="hanzo-id-footer-links">
            <a href={`/login${window.location.search}`}>Sign in</a>
          </p>
        </main>
      </div>
    )
  }

  return (
    <div className="hanzo-id-page hanzo-id-signup">
      <BrandHeader brand={brand} />
      <main>
        <h1>Create your {brand.name} account</h1>
        <SocialButtons
          client={client}
          clientIdOverride={clientIdOverride}
          intent="signup"
          postLoginRedirect={redirectUri}
        />
        <SignupForm
          client={client}
          inviteCode={inviteCode}
          clientIdOverride={clientIdOverride}
          redirectUri={redirectUri}
          state={state}
          codeChallenge={codeChallenge}
          codeChallengeMethod={codeChallengeMethod}
          nonce={nonce}
        />
        <p className="hanzo-id-footer-links">
          Already have an account? <a href={`/login${window.location.search}`}>Sign in</a>
        </p>
      </main>
    </div>
  )
}
