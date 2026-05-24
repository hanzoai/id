import type { BrandContract } from '@hanzo/id-shared'
import { BrandHeader } from '../components/BrandHeader'

export function Portal({ brand }: { brand: BrandContract }) {
  return (
    <div className="id-portal-page id-portal-portal">
      <BrandHeader brand={brand} />
      <main>
        <h1>Welcome to {brand.name}</h1>
        <p className="lede">{brand.description}</p>
        <div className="id-portal-cta-row">
          <a className="id-portal-btn primary" href="/login">Sign in</a>
          <a className="id-portal-btn" href="/signup">Create account</a>
        </div>
      </main>
    </div>
  )
}
