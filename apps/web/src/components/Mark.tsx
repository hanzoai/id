import { useState } from 'react'
import type { BrandContract } from '@hanzo/id-shared'

/**
 * The brand mark, top left, linking home.
 *
 * It is page CHROME, not part of any page — which is why it is rendered once by
 * the shell instead of by each of the nine pages that would otherwise import it.
 * Every page already carried the mark inside its footer, so the alternative was
 * nine imports and nine elements kept in step by hand.
 *
 * Top LEFT, not top centre: at the top of the column it sat between the person
 * and the credential, and a mark in the reading path is a thing to skip on a page
 * whose whole job is one field and one button. In the corner it is a page
 * identity — the same place a product puts it — and answers "whose sign-in is
 * this" without joining the queue.
 *
 * `wordmarkUrl ?? logoUrl`: the corner wants the LOGOTYPE, and settles for the
 * mark. Lux is the brand where the two differ — a 63x17 wordmark and a 100x100
 * triangle — and it is the reason the fields were separated at all. Hanzo, Zoo and
 * Pars ship only a square mark, so they fall through and the corner carries that.
 *
 * It degrades further to the brand NAME as text when neither asset is there or the
 * image fails, so a brand package that ships nothing shows a wordmark rather than a
 * broken-image icon.
 */
export function Mark({ brand }: { brand: BrandContract }) {
  const [imgOk, setImgOk] = useState(true)
  const src = brand.wordmarkUrl || brand.logoUrl
  const showImg = Boolean(src) && imgOk
  return (
    <a href="/" aria-label={brand.name} className="hanzo-id-mark">
      {showImg ? (
        <img src={src} alt={brand.name} height={28} onError={() => setImgOk(false)} />
      ) : (
        <span className="hanzo-id-wordmark">{brand.name}</span>
      )}
    </a>
  )
}
