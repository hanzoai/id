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
export async function loadBrand(brandPackage: string, brandUrl?: string): Promise<BrandContract> {
  // Browser: try the tenant's brandUrl (e.g. the jsDelivr-hosted brand.json
  // from config.json) first, then the app-local /brand/<pkg>/brand.json.
  //
  // Branding is cosmetic — it must NEVER block the login form. The SPA server
  // answers unknown paths with index.html (HTTP 200, text/html) for client-
  // side routing, so a missing brand.json comes back as HTML, not a 404. We
  // therefore reject any non-JSON response and, if every candidate fails,
  // return a minimal fallback brand so the app still renders. (Previously this
  // did `res.json()` on the HTML fallback → "Unexpected token '<'" → blank page.)
  if (typeof window !== 'undefined') {
    const candidates = [brandUrl, `/brand/${brandPackage}/brand.json`].filter(
      (u): u is string => typeof u === 'string' && u.length > 0,
    )
    for (const url of candidates) {
      try {
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) continue
        const ct = res.headers.get('content-type') ?? ''
        if (!ct.includes('json')) continue // SPA fallback HTML — not our brand.json
        const raw = (await res.json()) as { brand?: BrandContract }
        if (raw?.brand) return raw.brand
      } catch {
        // try the next candidate
      }
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
 * Minimal brand used only when no brand.json could be loaded — keeps the login
 * form rendering. Derives a display name from the package scope
 * (`@hanzo/brand` → "Hanzo").
 */
function fallbackBrand(brandPackage: string): BrandContract {
  const scope = brandPackage.match(/@([^/]+)\//)?.[1] ?? 'hanzo'
  const name = scope.charAt(0).toUpperCase() + scope.slice(1)
  return {
    name,
    title: 'Sign in',
    description: '',
    appDomain: '',
    logoUrl: '',
    faviconUrl: 'data:,',
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
