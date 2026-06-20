import type { BrandContract } from '@hanzo/id-shared'
import { LoginForm, SocialButtons, Divider, type AuthClient } from '@hanzo/id-auth'
import { BrandHeader } from '../components/BrandHeader'

export function Login({ client, brand }: { client: AuthClient; brand: BrandContract }) {
  const sp = new URLSearchParams(window.location.search)
  const redirectUri = sp.get('redirect_uri') ?? undefined
  const state = sp.get('state') ?? undefined
  const clientIdOverride = sp.get('client_id') ?? undefined
  const codeChallenge = sp.get('code_challenge') ?? undefined
  const codeChallengeMethod = (sp.get('code_challenge_method') as 'S256' | 'plain' | null) ?? undefined
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
        <Divider />
        <LoginForm
          client={client}
          redirectUri={redirectUri}
          state={state}
          clientIdOverride={clientIdOverride ?? undefined}
          codeChallenge={codeChallenge}
          codeChallengeMethod={codeChallengeMethod}
        />
        <p className="hanzo-id-footer-links">
          <a href="/forget">Forgot password?</a> · <a href="/signup">Create account</a>
        </p>
      </main>
    </div>
  )
}
