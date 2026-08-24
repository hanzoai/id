import type { BrandContract } from '@hanzo/id-shared'

/**
 * The product wordmark, top left, linking home.
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
 * SET IN TYPE, for every brand. The corner names a PRODUCT ("Hanzo ID", "Lux ID")
 * and a product name is a word, so it is drawn with the type scale. That is one
 * treatment across all four hosts, with nothing to fetch and no per-brand asset
 * whose intrinsic size decides how large the corner reads — the axis that made a
 * square symbol and a wordmark render at wildly different weights at one declared
 * height. The brand's own symbol still closes the page in `BrandFooter`.
 *
 * The anchor carries the name as text, so it needs no `aria-label`: the visible
 * word IS the accessible name, and a label beside identical text only gives a
 * screen reader two chances to say the same thing.
 */
export function Mark({ brand, label }: { brand: BrandContract; label?: string }) {
  return (
    <a href="/" className="hanzo-id-mark">
      {label ?? brand.name}
    </a>
  )
}
