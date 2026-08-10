import { useState } from 'react'
import { company, type BrandContract, type OrgConfig } from '@hanzo/id-shared'

/**
 * The legal lockup at the FOOT of an auth page: company and year, the legal
 * links under it, the brand mark last. Everything centered.
 *
 * It sits below the form rather than above it because the mark is not what
 * someone came here to do. A logo at the top is the first thing a screen reader
 * reads out and the first thing a returning user's eye has to skip, on a page
 * whose whole job is one field and one button. At the foot it still says whose
 * sign-in this is — which is what a white-label portal needs it for — without
 * standing between the person and the credential.
 *
 * `company` supplies the name and the links; a catalog entry overrides either
 * link per host. Both the name and each link render only when they exist, so a
 * brand whose company nobody has declared shows the mark alone rather than a
 * footer naming the wrong company or pointing at a page that isn't there.
 *
 * Same fallback as the header it replaces: the mark degrades to the brand NAME
 * as a text wordmark when the logo is absent or fails to load, so a brand
 * package that ships no asset shows a wordmark rather than a broken-image icon.
 */
export function BrandFooter({ brand, org }: { brand: BrandContract; org?: OrgConfig }) {
  const [imgOk, setImgOk] = useState(true)
  const showImg = Boolean(brand.logoUrl) && imgOk
  // Rendered, not hardcoded: a literal year is wrong every January and nobody
  // notices for months.
  const year = new Date().getFullYear()
  const co = company(brand, org?.orgId)
  const terms = org?.termsUrl ?? co?.terms
  const privacy = org?.privacyUrl ?? co?.privacy
  return (
    <footer className="hanzo-id-brand-footer">
      {co ? (
        <p className="hanzo-id-legal">
          {co.name}, {year}
        </p>
      ) : null}
      {terms || privacy ? (
        <p className="hanzo-id-legal-links">
          {terms ? <a href={terms}>Terms</a> : null}
          {terms && privacy ? <span aria-hidden="true"> | </span> : null}
          {privacy ? <a href={privacy}>Privacy</a> : null}
        </p>
      ) : null}
      <a href="/" aria-label={brand.name} className="hanzo-id-brand-mark">
        {showImg ? (
          <img src={brand.logoUrl} alt={brand.name} height={28} onError={() => setImgOk(false)} />
        ) : (
          <span className="hanzo-id-wordmark">{brand.name}</span>
        )}
      </a>
    </footer>
  )
}
