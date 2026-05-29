import type { TenantConfig } from './types'

/**
 * Resolve a TenantConfig by hostname.
 *
 * Resolution order:
 *   1. Runtime catalog (parsed from `window.__ID_CATALOG__`, served by the
 *      pod's `/config.json` from `SPA_IAM_TENANT_CONFIG_JSON` at deploy time).
 *   2. Hostname-derived defaults (no brand-specific entries in source).
 *
 * The catalog supplies all brand-specific knowledge (npm-scope-vs-org
 * mismatch like `lux` → `@luxfi/brand`, custom clientId, etc.). The image
 * carries zero brand-specific data — adding a new brand never touches
 * this repo.
 *
 * Hostname derivation rules (covers `<org>.id`, `id.<org>.<tld>`,
 * `iam.<org>.<tld>`, and `www.` variants) just give a sensible default.
 * Anything more nuanced belongs in the catalog.
 */

const TRIM_TRAILING_SLASH = (s: string): string => s.replace(/\/+$/, '')

export interface ResolveOptions {
  /** Runtime catalog, host → partial TenantConfig overrides. */
  readonly catalog?: Record<string, Partial<TenantConfig>>
}

export function resolveTenant(hostname: string, opts: ResolveOptions = {}): TenantConfig {
  const host = stripPort(hostname).toLowerCase()
  const derived = deriveTenant(host)
  const override = opts.catalog?.[host] ?? {}
  return normalize({ ...derived, ...override })
}

/**
 * Brand-agnostic hostname → TenantConfig derivation.
 * No hardcoded org names, no hardcoded brand packages.
 */
function deriveTenant(host: string): TenantConfig {
  const org = deriveOrg(host)
  return {
    orgId: org,
    iamUrl: `https://${host}`,
    iamIssuer: `https://${host}`,
    clientId: `${org}-id-portal`,
    appName: `${org}-id`,
    publicOrigin: `https://${host}`,
    brandUrl: `https://cdn.jsdelivr.net/npm/@${org}/brand@latest/brand.json`,
  }
}

/**
 * Extract an org slug from a hostname.
 *
 *   foo.id             → foo
 *   www.foo.id         → foo
 *   id.foo.network     → foo
 *   iam.foo.network    → foo
 *   anything else      → first label
 */
function deriveOrg(host: string): string {
  const h = host.startsWith('www.') ? host.slice(4) : host
  if (h.endsWith('.id')) {
    const labels = h.slice(0, -3).split('.')
    return labels[labels.length - 1] || 'hanzo'
  }
  const m = /^(?:id|iam)\.([^.]+)\.[^.]+$/.exec(h)
  if (m && m[1]) return m[1]
  return h.split('.')[0] || 'hanzo'
}

function stripPort(h: string): string {
  return h.replace(/:\d+$/, '')
}

function normalize(t: TenantConfig): TenantConfig {
  return {
    ...t,
    iamUrl: TRIM_TRAILING_SLASH(t.iamUrl),
    iamIssuer: TRIM_TRAILING_SLASH(t.iamIssuer || t.iamUrl),
    publicOrigin: TRIM_TRAILING_SLASH(t.publicOrigin),
    brandUrl: TRIM_TRAILING_SLASH(t.brandUrl),
  }
}

/** Parse the runtime catalog JSON safely; returns {} on any error. */
export function parseCatalog(raw: string | undefined | null): Record<string, Partial<TenantConfig>> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}
