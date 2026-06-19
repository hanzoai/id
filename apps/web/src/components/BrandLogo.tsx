import { useState } from 'react'
import type { BrandContract, TenantConfig } from '@hanzo/id-shared'

/**
 * Brand logo with a self-hosted fallback.
 *
 * `brand.logoUrl` is a CDN URL (jsdelivr). When that 404s or is blocked, we
 * fall back to the brand package's logo shipped inside this image at
 * `/brand/<pkg>/assets/logo/logo.svg` — the same package `loadBrand` fetches,
 * served by the same `hanzoai/spa` server. No external dependency required.
 */
export function BrandLogo({
  brand,
  tenant,
  height = 32,
}: {
  brand: BrandContract
  tenant: TenantConfig
  height?: number
}) {
  const local = `/brand/${encodeURIComponent(tenant.brandPackage)}/assets/logo/logo.svg`
  const [src, setSrc] = useState(brand.logoUrl || local)
  return (
    <img
      src={src}
      alt={brand.name}
      height={height}
      style={{ height, width: 'auto', display: 'block' }}
      onError={() => {
        if (src !== local) setSrc(local)
      }}
    />
  )
}
