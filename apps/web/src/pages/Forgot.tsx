import type { BrandContract } from '@hanzo/id-shared'
import { ForgotForm, type AuthClient } from '@hanzo/id-auth'
import { BrandHeader } from '../components/BrandHeader'

export function Forgot({ client, brand }: { client: AuthClient; brand: BrandContract }) {
  return (
    <div className="hanzo-id-page hanzo-id-forgot">
      <BrandHeader brand={brand} />
      <main>
        {/* Not "reset your password": what this page can do is prove you hold the
            address on the account and send a code that signs you back in. The new
            password comes after, from inside the account. */}
        <h1>Get back into your {brand.name} account</h1>
        <ForgotForm client={client} />
        <p className="hanzo-id-footer-links">
          <a href="/login">Back to sign in</a>
        </p>
      </main>
    </div>
  )
}
