import { useEffect, useId, useState } from 'react'
import type { Brand } from '@hanzo/id-shared'
import {
  Alert,
  LoginForm,
  MfaEnrollForm,
  OTPForm,
  SocialButtons,
  mfaChannelOf,
  authorizeRequest,
  type AuthClient,
  type BrowserAccount,
  type LoginResponse, attachParkedWallet } from '@hanzo/id-auth'
import { BrandFooter } from '../components/BrandFooter'
import { clientIdFrom, signupHref } from '../route'

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
  // hanzo.app's "Get started" forwards `signup=true`; `screen_hint=signup` is
  // the OIDC-standard spelling of the same request, so both are honored.
  const wantsSignup = sp.get('signup') === 'true' || sp.get('screen_hint') === 'signup'
  // prompt=select_account asks the person which account to use. IAM forwards it
  // here only after declining to answer from a session, and forwards login_hint
  // with it: the account an application named, which starts the form filled in.
  const choosing = Boolean(redirectUri) && (sp.get('prompt') ?? '').split(' ').includes('select_account')
  const hint = sp.get('login_hint') ?? ''
  // A subject (a UUID, or owner/name) names an account but is nothing a person types.
  const loginHint = hint && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(hint) && !hint.includes('/') ? hint : undefined
  const [phase, setPhase] = useState<'federate' | 'choose' | 'form' | 'register'>(
    providerHint ? 'federate' : wantsSignup ? 'register' : choosing ? 'choose' : 'form',
  )
  // The people signed in on this browser; null until IAM has answered.
  const [accounts, setAccounts] = useState<BrowserAccount[] | null>(null)

  // null = show the credential form; otherwise IAM returned an MFA signal and
  // we render the matching step instead of navigating on.
  const [mfa, setMfa] = useState<LoginResponse | null>(null)
  // Which identifier the credential form asks for. It lives HERE because two
  // siblings act on it — the form renders the field, the strip's phone entry
  // switches it — and a value two components share belongs to their parent.
  const [kind, setKind] = useState<'email' | 'phone'>('email')
  // The last refusal. IAM says the same sentence for a wrong password and for
  // an address with no account, so the page says where each case goes.
  const [refused, setRefused] = useState<string | null>(null)
  const [challengeError, setChallengeError] = useState<string | null>(null)
  const challengeErrorId = useId()

  const clientId = clientIdOverride ?? client.org.clientId

  // Whether this application takes new accounts. "Create a new account" is drawn only
  // when IAM says yes; an unreadable answer draws nothing. The server stays the
  // only gate.
  const [signupOpen, setSignupOpen] = useState(false)
  useEffect(() => {
    let live = true
    void client.getAppLogin(clientIdOverride, redirectUri).then((app) => {
      if (live) setSignupOpen(app?.enableSignUp === true)
    })
    return () => {
      live = false
    }
  }, [client, clientIdOverride, redirectUri])

  // Nobody signed in here means there is nobody to choose: the form it is.
  useEffect(() => {
    if (phase !== 'choose') return
    let live = true
    void client.accounts().then((list) => {
      if (!live) return
      if (list.length > 0) setAccounts(list)
      else setPhase('form')
    })
    return () => {
      live = false
    }
  }, [phase, client])

  // Choosing re-enters authorize naming that person by subject, which no two
  // accounts share (an address can belong to one person in two orgs), and IAM
  // answers from their session. The request is the one this page was handed, so
  // the code IAM mints is bound to the same client, redirect, state, nonce and
  // PKCE challenge.
  function choose(account: BrowserAccount) {
    const req = authorizeRequest(window.location.search, clientId)
    if (req) window.location.replace(client.authorize({ ...req, loginHint: account.sub }))
  }

  // The credential check succeeded (or MFA was satisfied). For a downstream
  // OIDC request, re-enter authorize with the now-established IAM session so it
  // mints the code; for a bare portal sign-in, land on onboarding.
  async function completeAfterAuth() {
    // A wallet refused earlier for having no account attaches to the account
    // that just satisfied its factor.
    await attachParkedWallet(client)
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
  // immediately bounce forward again. The whole request travels (`signupHref`).
  useEffect(() => {
    if (phase === 'register') {
      window.location.replace(signupHref(window.location.pathname, window.location.search))
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

  if (phase === 'choose') {
    return (
      <div className="hanzo-id-page hanzo-id-login">
        <main aria-busy={accounts === null || undefined}>
          <h1>Choose an account</h1>
          {accounts === null ? (
            <p>Finding your accounts…</p>
          ) : (
            <div className="hanzo-id-social">
              {accounts.map((a) => (
                <button key={a.sub} type="button" className="hanzo-id-btn ghost row hanzo-id-account" onClick={() => choose(a)}>
                  {a.avatar ? (
                    <img className="hanzo-id-avatar" src={a.avatar} alt="" />
                  ) : (
                    <span className="hanzo-id-avatar" aria-hidden="true">
                      {(a.displayName || a.name).slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="hanzo-id-account-who">
                    <span>{a.displayName || a.name}</span>
                    {a.email ? <span className="hanzo-id-account-email">{a.email}</span> : null}
                  </span>
                </button>
              ))}
              <button type="button" className="hanzo-id-btn ghost" onClick={() => setPhase('form')}>
                Use another account
              </button>
            </div>
          )}
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
        await attachParkedWallet(client)
        window.location.href = res.redirectUrl
      } else {
        await completeAfterAuth()
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
        {/* The form SIGNS IN, and the heading says so. IAM answers one sentence
            whether the password is wrong or the account does not exist, so the
            page cannot promise to tell a person which they are. A first-time
            identity arrives through a provider under the rule, which IAM
            provisions wherever the application allows sign-up.
            No brand in the heading: the mark top-left says whose sign-in this is. */}
        <h1>Sign in</h1>
        {/* THE CREDENTIAL LEADS: email or username, password, Continue, the code
            switch. Then "or", then Google, GitHub, the wallet and the phone —
            each drawn only when this application can complete it. The form is a
            child so PROVIDER_ORDER places it and the rule with everything else;
            that list is the one arrangement for every brand. */}
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
            onRefused={setRefused}
            kind={kind}
            onKind={setKind}
            identifier={loginHint}
          />
          {refused ? (
            <p className="hanzo-id-note" role="status">
              That didn&apos;t match. Forgot your password?{' '}
              <a href={`/forget${window.location.search}`}>Reset it</a>.
            </p>
          ) : null}
        </SocialButtons>
        <p className="hanzo-id-footer-links">
          <a href={`/forget${window.location.search}`}>Forgot password?</a>
        </p>
        {/* The way in for somebody with no account, as the last line of the
            column, in the style of the signup page's "Already have an account?".
            It opens registration for the same application with the same
            request, so the new account returns to the app that sent it. */}
        {signupOpen ? (
          <p className="hanzo-id-footer-links">
            No account?{' '}
            <a href={signupHref(window.location.pathname, window.location.search)}>Create a new account</a>
          </p>
        ) : null}
      </main>
      <BrandFooter brand={brand} org={client.org} />
    </div>
  )
}
