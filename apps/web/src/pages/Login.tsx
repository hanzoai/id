import { useEffect, useId, useState } from 'react'
import { idBrandLabel, type BrandContract } from '@hanzo/id-shared'
import {
  Alert,
  LoginForm,
  MfaEnrollForm,
  OTPForm,
  SocialButtons,
  mfaChannelOf,
  type AuthClient,
  type LoginResponse,
} from '@hanzo/id-auth'
import { BrandFooter } from '../components/BrandFooter'
import { clientIdFrom } from '../route'

export function Login({ client, brand }: { client: AuthClient; brand: BrandContract }) {
  const sp = new URLSearchParams(window.location.search)
  const redirectUri = sp.get('redirect_uri') ?? undefined
  const state = sp.get('state') ?? undefined
  const clientIdOverride = clientIdFrom(window.location.search, window.location.pathname)
  const codeChallenge = sp.get('code_challenge') ?? undefined
  const codeChallengeMethod = (sp.get('code_challenge_method') as 'S256' | 'plain' | null) ?? undefined
  const nonce = sp.get('nonce') ?? undefined
  // A provider the user already chose upstream (the console sends
  // `?provider_hint=provider-github` when they click "Continue with GitHub"
  // over there). With no live session we launch that provider straight away
  // instead of showing this form — so the click lands directly in the social
  // flow, never bouncing the user to a second login page. We honor ONLY
  // `provider_hint`, never a bare `provider=` (the SSO SDK uses that for its
  // `<org>-iam` IDP hint — a different meaning).
  const providerHint = sp.get('provider_hint') ?? undefined

  // TRUE single sign-on. When an app sent the user here for an authorization
  // code (client_id + redirect_uri present) AND the browser already holds an
  // issuer session from an earlier sign-in (the `iam_session_id` cookie), mint
  // the code from that session and redirect straight back — no form, no
  // credential re-entry. With no live session we fall back to auto-launching the
  // hinted provider if one was named, else the interactive form. A bare portal
  // visit (no client_id/redirect_uri) has nowhere to redirect, so it shows the
  // form immediately as before.
  // A caller that sent the user here to REGISTER should get registration.
  // hanzo.app's "Get started" forwards `signup=true` and this page ignored it,
  // so every net-new customer met a sign-in form with empty credentials and had
  // to notice the small "Create account" link to get past it — the signup funnel
  // never reached signup. `screen_hint=signup` is the OIDC-standard spelling of
  // the same request, so both are honored.
  //
  // It LOSES to silent SSO, deliberately. A browser already holding an issuer
  // session belongs to someone who has an account, and sending them to
  // registration would be worse than ignoring the hint. So it is the fallback
  // when there is no session, never a short-circuit ahead of one.
  const wantsSignup = sp.get('signup') === 'true' || sp.get('screen_hint') === 'signup'
  const canSilent = !!clientIdOverride && !!redirectUri
  const fallback = providerHint ? 'federate' : wantsSignup ? 'register' : 'form'
  const [phase, setPhase] = useState<'silent' | 'federate' | 'form' | 'register'>(
    canSilent ? 'silent' : fallback,
  )

  // null = show the credential form; otherwise IAM returned an MFA signal and
  // we render the matching step instead of navigating on.
  const [mfa, setMfa] = useState<LoginResponse | null>(null)
  // Which identifier the credential form asks for. It lives HERE because two
  // siblings act on it — the form renders the field, the strip's phone entry
  // switches it — and a value two components share belongs to their parent.
  const [kind, setKind] = useState<'email' | 'phone'>('email')
  const [challengeError, setChallengeError] = useState<string | null>(null)
  const challengeErrorId = useId()

  const clientId = clientIdOverride ?? client.org.clientId

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
          setPhase(fallback)
        }
      })
      .catch(() => {
        if (!cancelled) setPhase(fallback)
      })
    return () => {
      cancelled = true
    }
    // Run once on mount; the OAuth params are fixed for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The credential check succeeded (or MFA was satisfied). For a downstream
  // OIDC request, re-enter authorize with the now-established IAM session so it
  // mints the code; for a bare portal sign-in, land on onboarding.
  function completeAfterAuth() {
    if (redirectUri) {
      window.location.href = client.authorize({
        clientId,
        redirectUri,
        state: state ?? '',
        codeChallenge,
        codeChallengeMethod,
      })
    } else {
      window.location.href = '/onboarding'
    }
  }

  // Registration lives on its own page, so this is a real navigation rather than
  // a branch in the render. `replace`, not `assign`: Back from the signup form
  // must return to whatever sent the user here, not to a login page that would
  // immediately bounce forward again. The whole search string travels — the
  // client_id, redirect_uri, state and PKCE challenge are what let registration
  // return the new user to the app that asked for them.
  useEffect(() => {
    if (phase === 'register') {
      window.location.replace(`/signup${window.location.search}`)
    }
  }, [phase])

  if (phase === 'silent' || phase === 'register') {
    return (
      <div className="hanzo-id-page hanzo-id-login">
        <main aria-busy="true">
          <p>Signing you in…</p>
        </main>
        <BrandFooter brand={brand} org={client.org} />
      </div>
    )
  }

  // Auto-launch the hinted provider. `SocialButtons` is headless here — it
  // resolves the app config and runs the hop; we show a busy state meanwhile,
  // and drop to the form only if the hint matched no configured provider.
  if (phase === 'federate') {
    return (
      <div className="hanzo-id-page hanzo-id-login">
        <main aria-busy="true">
          <p>Signing you in…</p>
          <SocialButtons
            client={client}
            clientIdOverride={clientIdOverride}
            intent="signin"
            postLoginRedirect={redirectUri}
            autoStart={providerHint}
            onAutoStartResolved={(started) => {
              if (!started) setPhase('form')
            }}
          />
        </main>
        <BrandFooter brand={brand} org={client.org} />
      </div>
    )
  }

  if (mfa?.mfaStage === 'enroll') {
    return (
      <div className="hanzo-id-page hanzo-id-login">
        <main>
          <MfaEnrollForm client={client} onComplete={completeAfterAuth} />
        </main>
        <BrandFooter brand={brand} org={client.org} />
      </div>
    )
  }

  if (mfa?.mfaStage === 'challenge') {
    const iamType = mfa.mfaTypes?.[0] ?? 'app'
    async function onChallenge(code: string) {
      setChallengeError(null)
      const res = await client.mfaChallenge({
        mfaType: iamType,
        passcode: code,
        clientId,
        application: client.org.appName,
        organization: client.org.orgId,
        redirectUri,
        state,
        codeChallenge,
        codeChallengeMethod,
      })
      if (res.error) {
        setChallengeError(res.error)
      } else if (res.redirectUrl) {
        window.location.href = res.redirectUrl
      } else {
        completeAfterAuth()
      }
    }
    return (
      <div className="hanzo-id-page hanzo-id-login">
        <main>
          <h1>Two-factor authentication</h1>
          <p className="lede">Enter the code from your authenticator app to finish signing in.</p>
          <Alert id={challengeErrorId} message={challengeError} />
          <OTPForm channel={mfaChannelOf(iamType)} onSubmit={onChallenge} />
        </main>
        <BrandFooter brand={brand} org={client.org} />
      </div>
    )
  }

  return (
    <div className="hanzo-id-page hanzo-id-login">
      <main>
        {/* ONE door. The providers below finish a first-time identity as readily
            as a returning one — IAM's federation callback links or provisions —
            so a heading that said "Sign in" was naming half of what the page does
            and sending new people hunting for a second page. */}
        {/* It names the ID, because a white-label portal that says only "Login or
            Signup" does not say WHOSE — and this page is reached from another
            product's button, so the first thing to confirm is that you landed on
            the right identity. `idBrandLabel` per org: "Hanzo ID", "Lux ID",
            "Zoo Labs ID" (which is the host it answers on, zoolabs.id). */}
        <h1>Login or Signup with {idBrandLabel(brand, client.org.orgId)}</h1>
        {/* THE PROVIDERS LEAD. Most people arrive already signed into one of
            them and finish in one click, where the credential is two fields and a
            recall — so the shortest way in is first and the rule marks where it
            ends. 0.2.54 read it the other way and put the credential first; this
            is the arrangement the design asks for. The rule MOVED with the strip
            rather than staying put: a separator that holds its place while the
            things it separates swap ends up marking the wrong boundary. */}
        <SocialButtons
          client={client}
          clientIdOverride={clientIdOverride}
          intent="signin"
          postLoginRedirect={redirectUri}
          kind={kind}
          onKind={setKind}
        />
        <LoginForm
          client={client}
          redirectUri={redirectUri}
          state={state}
          clientIdOverride={clientIdOverride ?? undefined}
          codeChallenge={codeChallenge}
          codeChallengeMethod={codeChallengeMethod}
          nonce={nonce}
          onMfaRequired={setMfa}
          kind={kind}
          onKind={setKind}
        />
        <p className="hanzo-id-footer-links">
          {/* Carry the OIDC request across. These are full page loads, so a bare
              href drops the client_id, redirect_uri, state and PKCE challenge the
              app sent — and registration then has nothing to return the new user
              to. `Signup` reads exactly these params. */}
          <a href={`/forget${window.location.search}`}>Forgot password?</a> ·{' '}
          <a href={`/signup${window.location.search}`}>Create account</a>
        </p>
      </main>
      <BrandFooter brand={brand} org={client.org} />
    </div>
  )
}
