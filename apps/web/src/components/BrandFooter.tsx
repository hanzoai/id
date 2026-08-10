import { useState } from 'react'
import { company, type BrandContract, type OrgConfig } from '@hanzo/id-shared'

/**
 * The legal lockup at the FOOT of an auth page: company and year, then the legal
 * links. Centered.
 *
 * The MARK closes the page, under the legal lines — Lux's inverted triangle, each
 * brand's equivalent. It is the logotype's other half: the wordmark goes top left
 * as chrome (`components/Mark`), the mark goes here as a full stop.
 *
 * `logoUrl`, which means the mark and now points at one. NOT `faviconUrl`: a
 * favicon is a 16px tab icon and carries whatever ground and keyline it needs to
 * survive there, which is not what belongs at the foot of a page that already has
 * a ground.
 *
 * Hanzo, Zoo and Pars ship no wordmark, so on those hosts the corner and the foot
 * draw the same asset. That is the brand packages having one picture, not a rule
 * with an exception — the day one ships a wordmark, this separates with no change
 * here.
 *
 * `company` supplies the name and the links; a catalog entry overrides either link
 * per host. Both render only when they exist, so a portal never names the wrong
 * company or points at a page that is not there.
 */
export function BrandFooter({ brand, org }: { brand: BrandContract; org?: OrgConfig }) {
  const [imgOk, setImgOk] = useState(true)
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
      {brand.logoUrl && imgOk ? (
        // Decorative: the company above already names whose page this is, so an alt
        // text here would make a screen reader say the brand twice in two lines.
        <img
          className="hanzo-id-symbol"
          src={brand.logoUrl}
          alt=""
          width={24}
          height={24}
          onError={() => setImgOk(false)}
        />
      ) : null}
    </footer>
  )
}
