import type { BrandContract } from '@hanzo/id-shared'
import { BrandHeader } from '../components/BrandHeader'

export function Portal({ brand, signupEnabled }: { brand: BrandContract; signupEnabled: boolean }) {
  return (
    <div className="hanzo-id-page hanzo-id-portal">
      <BrandHeader brand={brand} />
      <main>
        <h1>Welcome to {brand.name}</h1>
        <p className="lede">{brand.description}</p>
        <div className="hanzo-id-cta-row">
          <a className="hanzo-id-btn primary" href="/login">Sign in</a>
          {signupEnabled ? <a className="hanzo-id-btn" href="/signup">Create account</a> : null}
        </div>
      </main>
    </div>
  )
}
