import type { BrandContract, TenantConfig } from '@hanzo/id-shared'
import { BrandLogo } from './BrandLogo'

export function BrandHeader({ brand, tenant }: { brand: BrandContract; tenant: TenantConfig }) {
  return (
    <header className="hanzo-id-brand-header">
      <a href="/" aria-label={brand.name}>
        <BrandLogo brand={brand} tenant={tenant} height={32} />
      </a>
    </header>
  )
}
