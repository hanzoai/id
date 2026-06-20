import { useState } from 'react'
import type { BrandContract } from '@hanzo/id-shared'

/**
 * Brand lockup for the auth pages. Renders the brand logo when it loads, and
 * falls back to the brand NAME as a text wordmark when the logo is absent or
 * fails to load — so a 404 logo (e.g. a brand package that doesn't ship its
 * assets) never shows a broken-image icon. The name always exists on the
 * brand contract, so the header is always presentable.
 */
export function BrandHeader({ brand }: { brand: BrandContract }) {
  const [imgOk, setImgOk] = useState(true)
  const showImg = Boolean(brand.logoUrl) && imgOk
  return (
    <header className="hanzo-id-brand-header">
      <a href="/" aria-label={brand.name}>
        {showImg ? (
          <img src={brand.logoUrl} alt={brand.name} height={32} onError={() => setImgOk(false)} />
        ) : (
          <span className="hanzo-id-wordmark">{brand.name}</span>
        )}
      </a>
    </header>
  )
}
