import type { BrandContract } from './types'

/**
 * Resolve a BrandContract from an absolute URL.
 *
 * No coupling to specific brand packages. The TenantConfig's `brandUrl`
 * is a full URL — npm CDN (`https://cdn.jsdelivr.net/npm/@foo/brand@latest/brand.json`),
 * a brand-owned host, or anywhere else. Whatever the URL is, it must
 * serve a JSON document `{ "brand": BrandContract }`.
 *
 * brand.json's `logoUrl` and `faviconUrl` are absolute URLs and used as-is.
 * Brands are responsible for hosting their own assets.
 */
export async function loadBrand(brandUrl: string): Promise<BrandContract> {
  const res = await fetch(brandUrl, { cache: 'no-store' })
  if (!res.ok) throw new Error(`brand.json fetch failed: ${res.status} for ${brandUrl}`)
  const raw = await res.json()
  if (!raw || typeof raw !== 'object' || !raw.brand) {
    throw new Error(`brand.json malformed (missing .brand): ${brandUrl}`)
  }
  return raw.brand as BrandContract
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
