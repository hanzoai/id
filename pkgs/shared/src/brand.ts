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
  // Browser: served by the app from /brand/<pkg>/brand.json
  if (typeof window !== 'undefined') {
    const url = `/brand/${brandPackage}/brand.json`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) throw new Error(`brand.json fetch failed: ${res.status} for ${brandPackage}`)
    const raw = await res.json()
    return localizeAssets(raw.brand as BrandContract, brandPackage)
  }
  // Node: dynamic import (build step + SSR fallback)
  const mod = (await import(/* @vite-ignore */ `${brandPackage}/brand.json`, {
    with: { type: 'json' },
  })) as { default: { brand: BrandContract } }
  return mod.default.brand
}

/**
 * Rewrite asset URLs in the brand contract to use our own /brand/<pkg>/...
 * static plugin instead of upstream CDNs (jsdelivr, etc.). The CDN URLs in
 * brand.json point at the pkg's `assets/logo/logo.svg` — same path the
 * Vite plugin emits — so the rewrite is mechanical.
 *
 * Pattern: any URL containing `/npm/<pkg>@.../<rest>` → `/brand/<pkg>/<rest>`.
 */
function localizeAssets(b: BrandContract, brandPackage: string): BrandContract {
  const rewrite = (url: string | undefined): string | undefined => {
    if (!url) return url
    const m = /\/npm\/([^@/]+(?:\/[^@/]+)?)@[^/]+\/(.+)$/.exec(url)
    if (!m) return url
    const pkg = m[1]
    const rest = m[2]
    // Only rewrite the brand's own pkg URLs; leave third-party CDN refs alone.
    if (pkg !== brandPackage) return url
    return `/brand/${pkg}/${rest}`
  }
  return {
    ...b,
    logoUrl: rewrite(b.logoUrl) ?? b.logoUrl,
    faviconUrl: rewrite(b.faviconUrl) ?? b.faviconUrl,
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
