import { idBrandLabel, type Brand } from '@hanzo/id-shared'

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
 *
 * The wording is DERIVED, not passed. `idBrandLabel` is the one place that turns
 * a brand into "<Brand> ID", and taking a caller's string instead let a page opt
 * out of it: the account page passed none and fell back to the brand's own
 * `name`, which some packages ship as a sibling product ("Lux Exchange"). Beside
 * a logo that was a wrong caption; as the whole corner it would be the wrong
 * product. One input, one rule, no site that can spell it differently.
 */
export function Mark({ brand, orgId }: { brand: Brand; orgId?: string }) {
  return (
    <a href="/" className="hanzo-id-mark">
      {idBrandLabel(brand, orgId)}
    </a>
  )
}
