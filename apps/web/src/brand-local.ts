/**
 * Localize a brand.json's runtime asset URLs.
 *
 * The per-org brand packages pin `logoUrl` / `faviconUrl` to
 * `cdn.jsdelivr.net/npm/@<scope>/brand@latest/...` — a third-party request on
 * a floating tag, ON THE CREDENTIAL-ENTRY PATH, which is exactly what this
 * surface refuses for fonts. The assets are small static files we can serve
 * ourselves: when a local copy exists (in the installed package, or the
 * checked-in escape hatch under `public/brand/<pkg>/`), rewrite the field to
 * a flat same-origin `/brand/<slug>/<file>` (flat for the same reason the
 * JSON is: the production static server's happy path is plain segments) and
 * report the file for emission. A URL with no local file behind it is left
 * VERBATIM — the wordmark fallback in BrandHeader behaves exactly as before.
 *
 * Pure: no I/O. The caller supplies `resolveLocal` (relative path inside the
 * brand package → absolute file path, or null) so the build plugin, the dev
 * middleware and the tests all share this one rewrite.
 */
export interface LocalizedBrand {
  /** brand.json text with local fields rewritten. */
  readonly json: string
  /** emitted fileName (`brand/<slug>/logo.svg`) → absolute source path. */
  readonly assets: ReadonlyMap<string, string>
}

/** The two asset URLs the portal renders at runtime (BrandHeader + favicon). */
const ASSET_FIELDS = ['logoUrl', 'faviconUrl'] as const

export function localizeBrandJson(
  raw: string,
  pkg: string,
  slug: string,
  resolveLocal: (relPath: string) => string | null,
): LocalizedBrand {
  const doc = JSON.parse(raw) as { brand?: Record<string, unknown> }
  const assets = new Map<string, string>()
  const brand = doc.brand
  if (brand) {
    const esc = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const cdn = new RegExp(`^https://cdn\\.jsdelivr\\.net/npm/${esc}@[^/]+/(.+)$`)
    for (const field of ASSET_FIELDS) {
      const url = brand[field]
      if (typeof url !== 'string') continue
      const m = cdn.exec(url)
      if (!m) continue
      const src = resolveLocal(m[1]!)
      if (!src) continue
      const fileName = `brand/${slug}/${m[1]!.split('/').pop()!}`
      const prior = assets.get(fileName)
      if (prior !== undefined && prior !== src) continue // basename collision — keep the URL
      assets.set(fileName, src)
      brand[field] = `/${fileName}`
    }
  }
  return { json: JSON.stringify(doc), assets }
}

/** Content-Type for the handful of asset shapes brand packages ship. */
export function brandAssetType(fileName: string): string {
  if (fileName.endsWith('.svg')) return 'image/svg+xml'
  if (fileName.endsWith('.png')) return 'image/png'
  if (fileName.endsWith('.ico')) return 'image/x-icon'
  if (fileName.endsWith('.webp')) return 'image/webp'
  return 'application/octet-stream'
}
