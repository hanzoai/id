import type { Brand } from './types'

/**
 * Resolve a Brand from a org's brand package.
 *
 * Each per-org brand pkg (`@hanzo/brand`, `@luxfi/brand`, `@zooai/brand`,
 * `@parsdao/brand`) ships a `brand.json` at the package root. This loader
 * fetches it at runtime so the portal does not need to import every brand
 * package's bundle (the unused ones tree-shake away).
 *
 * Build-time path (server, Node): use dynamic import of the JSON.
 * Runtime path (browser): fetch from `/brand/${pkg}/brand.json` (the
 * Vite plugin or the Express static serves the assets from each pkg's
 * `assets/` directory at this path).
 */
export async function loadBrand(brandPackage: string): Promise<Brand> {
  // Browser: served by the app from /brand/<pkg>/brand.json. The brand is
  // purely cosmetic, so a transient fetch failure must NEVER blank the login
  // form. Retry the (occasionally 502-flaky) asset a few times, then fall back
  // to a neutral brand so the form always renders.
  if (typeof window !== 'undefined') {
    // Flat, encoding-safe path emitted by the Vite brandJsonPlugin:
    // `@hanzo/brand` -> `/brand/hanzo.json`. A nested `@scope/brand/brand.json`
    // URL cannot be served by the production static server (literal `@` +
    // encoded `%2F` miss the on-disk file -> SPA catch-all returns index.html).
    const slug = brandPackage.replace(/^@/, '').split('/')[0] ?? 'hanzo'
    const url = `/brand/${slug}.json`
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { cache: 'no-store' })
        if (res.ok) {
          const raw = await res.json()
          return raw.brand as Brand
        }
      } catch {
        // network error — fall through to retry
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 150 * (attempt + 1)))
    }
    return fallbackBrand(brandPackage)
  }
  // Node: dynamic import (build step + SSR fallback)
  const mod = (await import(/* @vite-ignore */ `${brandPackage}/brand.json`, {
    with: { type: 'json' },
  })) as { default: { brand: Brand } }
  return mod.default.brand
}

/**
 * Last-resort brand when the asset is unreachable after retries. Keeps the
 * login form usable (a generic heading) instead of blanking the page. The
 * display name is derived from the pkg scope (`@hanzo/brand` -> "Hanzo"); the
 * few orgs whose scope differs from their display name are mapped.
 */
function fallbackBrand(brandPackage: string): Brand {
  const scope = brandPackage.replace(/^@/, '').split('/')[0] ?? 'hanzo'
  const overrides: Record<string, string> = { luxfi: 'Lux', zooai: 'Zoo', parsdao: 'Pars' }
  const name = overrides[scope] ?? scope.charAt(0).toUpperCase() + scope.slice(1)
  return {
    name,
    title: name,
    description: '',
    appDomain: '',
    logoUrl: '',
    faviconUrl: '',
  }
}

/** Subset of the brand contract safe to expose to the browser as window.__BRAND__. */
export interface BrandRuntime {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly logoUrl: string
  readonly faviconUrl: string
  readonly accentColor?: string
}

/**
 * Neutral identity-portal label — always "<Brand> ID". `Brand.name`
 * is meant to be the bare org display ("Lux"), but some brand packages ship
 * the product name ("Lux Exchange" / "Zoo Exchange"), which leaks a sibling
 * surface into the IAM portal heading + tab title. Prefer the org orgId
 * ("lux" → "Lux"); otherwise strip a trailing product word from the brand
 * name. So id.lux.network reads "Lux ID", never "Lux Exchange".
 */
/**
 * Orgs whose IDENTITY brand is not their capitalized org id.
 *
 * Zoo is the one: the org is `zoo`, the identity brand is "Zoo Labs", and the
 * host it answers on is zoolabs.id — so capitalizing the org id reads "Zoo ID"
 * on a page served from zoolabs.id. It is a per-org fact, so it lives beside the
 * function that needs it rather than as a brand string spelled into a heading.
 *
 * Everything absent from here is `cap(orgId)`, which is right for every other
 * org and stays right for the next one without an entry.
 */
const ID_BRAND: Record<string, string> = { zoo: 'Zoo Labs' }

export function idBrandLabel(brand: { name: string }, orgId?: string): string {
  const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')
  const org = (orgId ?? '').trim()
  const short =
    ID_BRAND[org.toLowerCase()] ||
    cap(org) ||
    (brand.name ?? '').replace(/\s+(Exchange|Network|Labs|Foundation|DAO|Wallet)\b.*$/i, '').trim() ||
    brand.name ||
    'Account'
  return `${short} ID`
}

/** The company behind a brand, and the legal pages it publishes. */
export interface Company {
  readonly name: string
  readonly terms?: string
  readonly privacy?: string
}

/**
 * Who a portal belongs to. A brand is not a company — "Zoo" ships as Zoo Labs
 * Foundation Inc and "Lux" as Lux Industries Inc — so a footer cannot print the
 * brand and add "Inc", and the brand packages carry no company at all. This map
 * is the only thing that knows.
 *
 * Per ORG, not per host, for the reason `idOriginFor` exists: an org answers on
 * several hostnames and a fact copied onto each row drifts. Keyed off the same
 * short brand `idBrandLabel` resolves, so id.lux.network and lux.id reach the
 * same company without a second notion of which brand a host is. A catalog entry
 * may still override the links per host.
 *
 * A brand absent from this map gets NOTHING and the footer omits the line, which
 * is not hypothetical: pars.id, id.bootno.de and osage.id are live hosts with no
 * entry. Add the company to claim it.
 *
 * Every URL here was fetched. `terms`/`privacy` are omitted where the page does
 * not exist rather than guessed from a sibling's path — lux.network answers 200
 * on /terms and /privacy with the byte-identical document it serves for a
 * nonsense path, and zoo.ngo publishes one combined page whose own Privacy link
 * points back at /terms. A legal link that lands on a marketing page is worse
 * than an absent one.
 */
const COMPANIES: Readonly<Record<string, Company>> = {
  hanzo: { name: 'Hanzo AI Inc', terms: 'https://hanzo.ai/terms', privacy: 'https://hanzo.ai/privacy' },
  zoo: { name: 'Zoo Labs Foundation Inc', terms: 'https://zoo.ngo/terms' },
  lux: { name: 'Lux Industries Inc' },
}

export function company(brand: { name: string }, orgId?: string): Company | null {
  // Keyed on the ORG, which is identity, not on the display label, which is
  // presentation. This used to strip " ID" off idBrandLabel and look the
  // remainder up — so the day zoo's label became "Zoo Labs ID" the key became
  // "zoo labs", the lookup missed, and every zoolabs.id footer silently lost its
  // company name and its terms link. A label is allowed to change; a lookup that
  // reads one is a rename away from returning null with nothing to say so.
  //
  // The brand-name derivation survives for the one caller that has no org (a host
  // that resolved nothing), where a guess from the name beats no answer at all.
  const org = (orgId ?? '').trim().toLowerCase()
  if (org !== '') return COMPANIES[org] ?? null
  const short = idBrandLabel(brand).replace(/\s+ID$/, '')
  return COMPANIES[short.toLowerCase()] ?? null
}

export function toBrandRuntime(b: Brand): BrandRuntime {
  return {
    name: b.name,
    title: b.title,
    description: b.description,
    logoUrl: b.logoUrl,
    faviconUrl: b.faviconUrl,
    accentColor: b.accentColor,
  }
}
