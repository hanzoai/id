import type { BrandContract } from '@hanzo/id-shared'
import { SignupForm, SocialButtons, Divider, type AuthClient } from '@hanzo/id-auth'
import { BrandHeader } from '../components/BrandHeader'

export function Signup({ client, brand }: { client: AuthClient; brand: BrandContract }) {
  const sp = new URLSearchParams(window.location.search)
  const inviteCode = sp.get('invite') ?? undefined
  const clientIdOverride = sp.get('client_id') ?? undefined
  return (
    <div className="hanzo-id-page hanzo-id-signup">
      <BrandHeader brand={brand} />
      <main>
        <h1>Create your {brand.name} account</h1>
        <SocialButtons client={client} clientIdOverride={clientIdOverride} intent="signup" />
        <Divider />
        <SignupForm client={client} inviteCode={inviteCode} />
        <p className="hanzo-id-footer-links">
          Already have an account? <a href="/login">Sign in</a>
        </p>
      </main>
    </div>
  )
}
