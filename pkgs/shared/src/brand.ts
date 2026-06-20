import type { BrandContract } from './types'

/**
 * Resolve a BrandContract from a tenant's brand package.
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
export async function loadBrand(brandPackage: string): Promise<BrandContract> {
  // Browser: served by the app from /brand/<pkg>/brand.json. The brand is
  // purely cosmetic, so a transient fetch failure must NEVER blank the login
  // form. Retry the (occasionally 502-flaky) asset a few times, then fall back
  // to a neutral brand so the form always renders.
  if (typeof window !== 'undefined') {
    const url = `/brand/${encodeURIComponent(brandPackage)}/brand.json`
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { cache: 'no-store' })
        if (res.ok) {
          const raw = await res.json()
          return raw.brand as BrandContract
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
  })) as { default: { brand: BrandContract } }
  return mod.default.brand
}

/**
 * Last-resort brand when the asset is unreachable after retries. Keeps the
 * login form usable (a generic heading) instead of blanking the page. The
 * display name is derived from the pkg scope (`@hanzo/brand` -> "Hanzo"); the
 * few tenants whose scope differs from their display name are mapped.
 */
function fallbackBrand(brandPackage: string): BrandContract {
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

export function toBrandRuntime(b: BrandContract): BrandRuntime {
  return {
    name: b.name,
    title: b.title,
    description: b.description,
    logoUrl: b.logoUrl,
    faviconUrl: b.faviconUrl,
    accentColor: b.accentColor,
  }
}
