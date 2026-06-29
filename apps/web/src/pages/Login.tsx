import { useState } from 'react'
import type { BrandContract } from '@hanzo/id-shared'
import {
  LoginForm,
  MfaEnrollForm,
  OTPForm,
  SocialButtons,
  mfaChannelOf,
  type AuthClient,
  type LoginResponse,
} from '@hanzo/id-auth'
import { BrandHeader } from '../components/BrandHeader'

export function Login({ client, brand }: { client: AuthClient; brand: BrandContract }) {
  const sp = new URLSearchParams(window.location.search)
  const redirectUri = sp.get('redirect_uri') ?? undefined
  const state = sp.get('state') ?? undefined
  const clientIdOverride = sp.get('client_id') ?? undefined
  const codeChallenge = sp.get('code_challenge') ?? undefined
  const codeChallengeMethod = (sp.get('code_challenge_method') as 'S256' | 'plain' | null) ?? undefined

  // null = show the credential form; otherwise IAM returned an MFA signal and
  // we render the matching step instead of navigating on.
  const [mfa, setMfa] = useState<LoginResponse | null>(null)
  const [challengeError, setChallengeError] = useState<string | null>(null)

  const clientId = clientIdOverride ?? client.tenant.clientId

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

  if (mfa?.mfaStage === 'enroll') {
    return (
      <div className="hanzo-id-page hanzo-id-login">
        <BrandHeader brand={brand} />
        <main>
          <MfaEnrollForm client={client} onComplete={completeAfterAuth} />
        </main>
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
        application: client.tenant.appName,
        organization: client.tenant.orgId,
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
        <BrandHeader brand={brand} />
        <main>
          <h1>Two-factor authentication</h1>
          <p className="lede">Enter the code from your authenticator app to finish signing in.</p>
          {challengeError ? <p role="alert" className="hanzo-id-error">{challengeError}</p> : null}
          <OTPForm channel={mfaChannelOf(iamType)} onSubmit={onChallenge} />
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
          onMfaRequired={setMfa}
        />
        <p className="hanzo-id-footer-links">
          <a href="/forget">Forgot password?</a> · <a href="/signup">Create account</a>
        </p>
      </main>
    </div>
  )
}
