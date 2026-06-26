import { useEffect, useState } from 'react'
import type { BrandContract } from '@hanzo/id-shared'
import { LoginForm, SocialButtons, type AuthClient } from '@hanzo/id-auth'
import { BrandHeader } from '../components/BrandHeader'

export function Login({ client, brand }: { client: AuthClient; brand: BrandContract }) {
  const sp = new URLSearchParams(window.location.search)
  const redirectUri = sp.get('redirect_uri') ?? undefined
  const state = sp.get('state') ?? undefined
  const clientIdOverride = sp.get('client_id') ?? undefined
  const codeChallenge = sp.get('code_challenge') ?? undefined
  const codeChallengeMethod = (sp.get('code_challenge_method') as 'S256' | 'plain' | null) ?? undefined
  const nonce = sp.get('nonce') ?? undefined

  // TRUE single sign-on. When an app sent the user here for an authorization
  // code (client_id + redirect_uri present) AND the browser already holds an
  // issuer session from an earlier sign-in (the `iam_session_id` cookie), mint
  // the code from that session and redirect straight back — no form, no
  // credential re-entry. Only fall back to the interactive form when there is
  // no live session. A bare portal visit (no client_id/redirect_uri) has
  // nowhere to redirect, so it shows the form immediately as before.
  const canSilent = !!clientIdOverride && !!redirectUri
  const [phase, setPhase] = useState<'silent' | 'form'>(canSilent ? 'silent' : 'form')

  useEffect(() => {
    if (!canSilent) return
    let cancelled = false
    client
      .silentLogin({
        clientId: clientIdOverride!,
        application: clientIdOverride!,
        redirectUri: redirectUri!,
        state,
        codeChallenge,
        codeChallengeMethod,
        nonce,
      })
      .then((r) => {
        if (cancelled) return
        if (r.redirectUrl) {
          window.location.assign(r.redirectUrl)
        } else {
          setPhase('form')
        }
      })
      .catch(() => {
        if (!cancelled) setPhase('form')
      })
    return () => {
      cancelled = true
    }
    // Run once on mount; the OAuth params are fixed for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (phase === 'silent') {
    return (
      <div className="hanzo-id-page hanzo-id-login">
        <BrandHeader brand={brand} />
        <main aria-busy="true">
          <p>Signing you in…</p>
        </main>
      </div>
    )
  }

  return (
    <div className="hanzo-id-page hanzo-id-login">
      <BrandHeader brand={brand} />
      <main>
        <h1>Sign in to {brand.name}</h1>
        <SocialButtons
          client={client}
          clientIdOverride={clientIdOverride}
          intent="signin"
          postLoginRedirect={redirectUri}
        />
        <LoginForm
          client={client}
          redirectUri={redirectUri}
          state={state}
          clientIdOverride={clientIdOverride ?? undefined}
          codeChallenge={codeChallenge}
          codeChallengeMethod={codeChallengeMethod}
          nonce={nonce}
        />
        <p className="hanzo-id-footer-links">
          <a href="/forget">Forgot password?</a> · <a href="/signup">Create account</a>
        </p>
      </main>
    </div>
  )
}
