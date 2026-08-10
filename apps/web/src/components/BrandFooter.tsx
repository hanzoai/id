import { useState } from 'react'
import type { BrandContract, OrgConfig } from '@hanzo/id-shared'

/**
 * The brand lockup, at the FOOT of an auth page: mark centered, copyright under
 * it, legal links beside the copyright.
 *
 * It sits below the form rather than above it because the mark is not what
 * someone came here to do. A logo at the top is the first thing a screen reader
 * reads out and the first thing a returning user's eye has to skip, on a page
 * whose whole job is one field and one button. At the foot it still says whose
 * sign-in this is — which is what a white-label portal needs it for — without
 * standing between the person and the credential.
 *
 * Same fallback as the header it replaces: the mark degrades to the brand NAME
 * as a text wordmark when the logo is absent or fails to load, so a brand
 * package that ships no asset shows a wordmark rather than a broken-image icon.
 * The name is always on the contract, so the footer is always presentable.
 */
export function BrandFooter({ brand, org }: { brand: BrandContract; org?: OrgConfig }) {
  const [imgOk, setImgOk] = useState(true)
  const showImg = Boolean(brand.logoUrl) && imgOk
  // Rendered, not hardcoded: a literal year is wrong every January and nobody
  // notices for months.
  const year = new Date().getFullYear()
  return (
    <footer className="hanzo-id-brand-footer">
      <a href="/" aria-label={brand.name} className="hanzo-id-brand-mark">
        {showImg ? (
          <img src={brand.logoUrl} alt={brand.name} height={28} onError={() => setImgOk(false)} />
        ) : (
          <span className="hanzo-id-wordmark">{brand.name}</span>
        )}
      </a>
      <p className="hanzo-id-legal">
        <span>
          © {year} {brand.name}
        </span>
        {/* Each link renders only when the brand declares it — see OrgConfig.
            A derived path would 404 on every brand, which is worse than absent. */}
        {org?.termsUrl ? (
          <>
            <span aria-hidden="true"> · </span>
            <a href={org.termsUrl}>Terms</a>
          </>
        ) : null}
        {org?.privacyUrl ? (
          <>
            <span aria-hidden="true"> · </span>
            <a href={org.privacyUrl}>Privacy</a>
          </>
        ) : null}
      </p>
    </footer>
  )
}
