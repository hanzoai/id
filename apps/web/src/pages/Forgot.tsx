import type { BrandContract } from '@hanzo/id-shared'
import { ForgotForm, type AuthClient } from '@hanzo/id-auth'
import { BrandHeader } from '../components/BrandHeader'

export function Forgot({ client, brand }: { client: AuthClient; brand: BrandContract }) {
  return (
    <div className="id-portal-page id-portal-forgot">
      <BrandHeader brand={brand} />
      <main>
        <h1>Reset your {brand.name} password</h1>
        <ForgotForm client={client} />
        <p className="id-portal-footer-links">
          <a href="/login">Back to sign in</a>
        </p>
      </main>
    </div>
  )
}
