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
