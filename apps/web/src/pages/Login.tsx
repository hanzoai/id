import { useEffect, useId, useState } from 'react'
import type { Brand } from '@hanzo/id-shared'
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

export function Login({ client, brand }: { client: AuthClient; brand: Brand }) {
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

  // Reaching this page ALREADY MEANS there is no session to sign in with.
  //
  // Single sign-on is the issuer's, and it happens one hop upstream:
  // `/v1/iam/oauth/authorize` calls `silentGrant` (iam internal/oidc/authorize.go)
  // and, when a live `iam_session_id` answers the request, 302s straight to the
  // app's redirect_uri with a code. It only falls through to this page when that
  // refused — no session, a session too old for `max_age`, an id_token_hint
  // naming somebody else — or when the client asked for a screen outright with
  // `prompt=login` / `prompt=select_account`. Measured against production: with
  // a live session, authorize redirects to the callback with a code and this
  // page never loads at all.
  //
  // So a silent mint attempted HERE could only ever re-ask a question the server
  // had just answered no to, one hop earlier. It POSTed /v1/iam/login on mount
  // with nothing but `{type:'code', application}`, and IAM refused it —
  // `login_required` — for every signed-out visitor. That 400 sat in the console
  // of every sign-in, permanently, wearing the same shape as a real credential
  // failure.
  //
  // Worse, on the paths where authorize deliberately skips its silent branch,
  // the client mint SUCCEEDED and overrode the decision: `prompt=login` and
  // `max_age=0` both minted a code from the ambient session and bounced through
  // with no screen shown — the re-authentication a relying party asks for before
  // a sensitive operation, silently not performed.
  //
  // The page therefore renders what it is for: a credential form.
  //
  // A caller that sent the user here to REGISTER should get registration.
  // hanzo.app's "Get started" forwards `signup=true` and this page ignored it,
  // so every net-new customer met a sign-in form with empty credentials and had
  // to notice the small "Create account" link to get past it — the signup funnel
  // never reached signup. `screen_hint=signup` is the OIDC-standard spelling of
  // the same request, so both are honored.
  const wantsSignup = sp.get('signup') === 'true' || sp.get('screen_hint') === 'signup'
  const [phase, setPhase] = useState<'federate' | 'form' | 'register'>(
    providerHint ? 'federate' : wantsSignup ? 'register' : 'form',
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

  if (phase === 'register') {
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
        {/* No brand in the heading: the mark sits top-left on every page now and
            says whose sign-in this is. Naming it again here put "Lux ID" directly
            under the LUX wordmark — the same fact twice, and on lux the wordmark
            is 104px wide, so the pair read as the loudest thing on a page whose
            job is one field and one button. */}
        <h1>Login or Signup</h1>
        {/* THE ONE-CLICK ENTRIES LEAD. Most people arrive already signed into
            Google or GitHub and finish in one press, where the credential is two
            fields and a recall — so the shortest way in is first and the rule
            marks where it ends. 0.2.54 read it the other way and put the
            credential first; this is the arrangement the design asks for.

            The column runs THROUGH the form, which is why the form is a child
            here: the wallet and the phone follow it. They used to precede it,
            because they were in the strip and the strip led the page, so somebody
            with an email address and a small business met two specialist entries
            before the field they came for. PROVIDER_ORDER is where that reads. */}
        <SocialButtons
          client={client}
          clientIdOverride={clientIdOverride}
          intent="signin"
          postLoginRedirect={redirectUri}
          kind={kind}
          onKind={setKind}
        >
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
          {/* The heading offers two things and only one of them was a control.
              Registration was 13px of text at the foot of the page, beside the
              link for people who forgot a password — so a first-time visitor,
              whose ONLY business here is this door, had to read past every way of
              signing in to find it. It is a button of the same size and surface as
              the ways in, directly under the credential it is the alternative to.

              Carry the OIDC request across: this is a full page load, so a bare
              href drops the client_id, redirect_uri, state and PKCE challenge the
              app sent, and registration then has nothing to return the new account
              to. `Signup` reads exactly these params. */}
          <a className="hanzo-id-btn ghost" href={`/signup${window.location.search}`}>
            Create account
          </a>
        </SocialButtons>
        <p className="hanzo-id-footer-links">
          <a href={`/forget${window.location.search}`}>Forgot password?</a>
        </p>
      </main>
      <BrandFooter brand={brand} org={client.org} />
    </div>
  )
}
