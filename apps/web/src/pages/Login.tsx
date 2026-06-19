import type { BrandContract } from '@hanzo/id-shared'
import { LoginForm, type AuthClient } from '@hanzo/id-auth'
import { BrandHeader } from '../components/BrandHeader'

export function Login({ client, brand, signupEnabled }: { client: AuthClient; brand: BrandContract; signupEnabled: boolean }) {
  const sp = new URLSearchParams(window.location.search)
  const redirectUri = sp.get('redirect_uri') ?? undefined
  const state = sp.get('state') ?? undefined
  const clientIdOverride = sp.get('client_id') ?? undefined
  return (
    <div className="hanzo-id-page hanzo-id-login">
      <BrandHeader brand={brand} />
      <main>
        <h1>Sign in to {brand.name}</h1>
        <LoginForm
          client={client}
          redirectUri={redirectUri}
          state={state}
          clientIdOverride={clientIdOverride ?? undefined}
        />
        <p className="hanzo-id-footer-links">
          <a href="/forget">Forgot password?</a>{signupEnabled ? <> · <a href="/signup">Create account</a></> : null}
        </p>
      </main>
    </div>
  )
}
