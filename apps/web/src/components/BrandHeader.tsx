import type { BrandContract } from '@hanzo/id-shared'

export function BrandHeader({ brand }: { brand: BrandContract }) {
  return (
    <header className="id-portal-brand-header">
      <a href="/" aria-label={brand.name}>
        <img src={brand.logoUrl} alt={brand.name} height={32} />
      </a>
    </header>
  )
}
