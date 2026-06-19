import type { BrandContract, TenantConfig } from '@hanzo/id-shared'
import { SignupForm, type AuthClient } from '@hanzo/id-auth'
import { BrandLogo } from '../components/BrandLogo'
import { MarketingPanel } from '../components/MarketingPanel'
import { marketingFor } from '../marketing'

/** Split-view signup, mirroring the restored login layout. */
export function Signup({ client, brand, tenant }: { client: AuthClient; brand: BrandContract; tenant: TenantConfig }) {
  const sp = new URLSearchParams(window.location.search)
  const inviteCode = sp.get('invite') ?? undefined
  const accent = brand.accentColor ?? '#ffffff'
  const marketing = marketingFor(tenant.orgId)
  const search = window.location.search

  return (
    <div className="hanzo-id-split">
      <section className="hanzo-id-split-form">
        <div className="hanzo-id-card">
          <header className="hanzo-id-card-head">
            <a href="/" aria-label={brand.name}>
              <BrandLogo brand={brand} tenant={tenant} height={36} />
            </a>
          </header>
          <h1 className="hanzo-id-card-title">Create your {brand.name} account</h1>
          <SignupForm client={client} inviteCode={inviteCode} />
          <p className="hanzo-id-footer-links">
            Already have an account? <a href={`/login${search}`}>Sign in</a>
          </p>
        </div>
      </section>

      <aside className="hanzo-id-split-brand">
        <MarketingPanel marketing={marketing} accent={accent} />
      </aside>
    </div>
  )
}
