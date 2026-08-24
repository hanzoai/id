import type { Brand } from '@hanzo/id-shared'
import { ForgotForm, type AuthClient } from '@hanzo/id-auth'
import { BrandFooter } from '../components/BrandFooter'

export function Forgot({ client, brand }: { client: AuthClient; brand: Brand }) {
  return (
    <div className="hanzo-id-page hanzo-id-forgot">
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
      <BrandFooter brand={brand} org={client.org} />
    </div>
  )
}
