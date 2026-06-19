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
    const url = `/brand/${encodeURIComponent(brandPackage)}/brand.json`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) throw new Error(`brand.json fetch failed: ${res.status} for ${brandPackage}`)
    // The SPA server returns index.html (HTTP 200, text/html) for unknown
    // paths, so a missing brand.json yields HTML, not JSON. Read as text and
    // parse explicitly so we throw a precise error instead of a cryptic
    // "Unexpected token '<'" that whites-out the whole portal.
    const text = await res.text()
    let raw: { brand?: BrandContract }
    try {
      raw = JSON.parse(text) as { brand?: BrandContract }
    } catch {
      throw new Error(`brand.json for ${brandPackage} is not JSON (got ${res.headers.get('content-type') ?? 'unknown'}); is /brand/<pkg>/brand.json served?`)
    }
    if (!raw.brand) throw new Error(`brand.json for ${brandPackage} has no "brand" key`)
    return raw.brand
  }
  // Node: dynamic import (build step + SSR fallback)
  const mod = (await import(/* @vite-ignore */ `${brandPackage}/brand.json`, {
    with: { type: 'json' },
  })) as { default: { brand: BrandContract } }
  return mod.default.brand
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
