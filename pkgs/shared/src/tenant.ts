import type { TenantConfig } from './types'

/**
 * Resolve a TenantConfig by hostname.
 *
 * Resolution order (first hit wins):
 *   1. `IAM_TENANT_CONFIG_JSON` runtime catalog (set in K8s ConfigMap, served
 *      to the browser via `/config.json` at pod startup).
 *   2. Built-in defaults for the four canonical Hanzo identity hosts.
 *   3. `IAM_DEFAULT_ORG` (or "hanzo") fallback — used for unknown hosts
 *      (preview deploys, local dev, custom domains pre-launch).
 *
 * No hardcoded hostname switches anywhere downstream. Adding a tenant
 * means editing the runtime catalog, never editing source.
 */

const TRIM_TRAILING_SLASH = (s: string): string => s.replace(/\/+$/, '')

/**
 * Built-in tenants for the four canonical identity hosts.
 *
 * `iamUrl` is the per-brand OIDC ISSUER — the host that serves
 * `/.well-known/openid-configuration` and the `/v1/iam/*` surface. Per
 * HIP-0111 this is the brand's own `*.id` host (hanzo.id / lux.id / …),
 * NOT `iam.hanzo.ai`: discovery must be host-relative so the SDK never
 * resolves to the wrong origin (or the IAM SPA HTML catch-all). The IAM
 * backend tenant-scopes on the `organization` body param; one backend
 * serves every brand behind its own issuer host.
 *
 * `clientId` is the brand `-id` app registered in `init_data.json`
 * (`hanzo-id`, `lux-id`, …) so the portal authenticates as that app — the
 * same app whose enabled providers (password + GitHub + Google + Web3)
 * `get-app-login` reports.
 */
const DEFAULT_TENANTS: Record<string, TenantConfig> = {
  'hanzo.id': {
    orgId: 'hanzo',
    iamUrl: 'https://hanzo.id',
    iamIssuer: 'https://hanzo.id',
    clientId: 'hanzo-id',
    appName: 'hanzo-id',
    publicOrigin: 'https://hanzo.id',
    brandPackage: '@hanzo/brand',
  },
  'lux.id': {
    orgId: 'lux',
    iamUrl: 'https://lux.id',
    iamIssuer: 'https://lux.id',
    clientId: 'lux-id',
    appName: 'lux-id',
    publicOrigin: 'https://lux.id',
    brandPackage: '@luxfi/brand',
  },
  'zoo.id': {
    orgId: 'zoo',
    iamUrl: 'https://zoo.id',
    iamIssuer: 'https://zoo.id',
    clientId: 'zoo-id',
    appName: 'zoo-id',
    publicOrigin: 'https://zoo.id',
    brandPackage: '@zooai/brand',
  },
  'pars.id': {
    orgId: 'pars',
    iamUrl: 'https://pars.id',
    iamIssuer: 'https://pars.id',
    // The portal app is `pars-console` (it carries the https://pars.id/callback
    // redirect); a bare `pars-id` app does not exist in IAM.
    clientId: 'pars-console',
    appName: 'pars-console',
    publicOrigin: 'https://pars.id',
    brandPackage: '@parsdao/brand',
  },
  // Osage is served by this portal too; without a built-in it would fall back
  // to the Hanzo default and leak the wrong brand if the runtime catalog ever
  // fails to load. (osage-id-portal is pre-launch — no IAM app yet — but the
  // brand must read as Osage, never Hanzo.)
  'osage.id': {
    orgId: 'osage',
    iamUrl: 'https://osage.id',
    iamIssuer: 'https://osage.id',
    clientId: 'osage-id-portal',
    appName: 'osage-id',
    publicOrigin: 'https://osage.id',
    brandPackage: '@osage/brand',
  },
  'www.osage.id': {
    orgId: 'osage',
    iamUrl: 'https://www.osage.id',
    iamIssuer: 'https://www.osage.id',
    clientId: 'osage-id-portal',
    appName: 'osage-id',
    publicOrigin: 'https://www.osage.id',
    brandPackage: '@osage/brand',
  },
}

/**
 * A runtime catalog entry as it appears in the K8s ConfigMap / `/config.json`.
 * It carries the human-authored shape — notably `brandUrl` (a CDN URL), which
 * this module maps onto the code-facing `brandPackage`. All fields optional;
 * whatever is present overrides the host-derived base.
 */
export type CatalogEntry = Partial<TenantConfig> & {
  /** CDN URL of the brand package, e.g. `…/npm/@osage/brand@latest/brand.json`. */
  readonly brandUrl?: string
}

export interface ResolveOptions {
  /** Optional runtime catalog (parsed from IAM_TENANT_CONFIG_JSON or /config.json). */
  readonly catalog?: Record<string, CatalogEntry>
  /** Default org slug when host has no entry. */
  readonly defaultOrg?: string
}

export function resolveTenant(hostname: string, opts: ResolveOptions = {}): TenantConfig {
  const host = stripPort(hostname).toLowerCase()
  const catalogEntry = opts.catalog?.[host]
  const builtIn = DEFAULT_TENANTS[host]
  if (catalogEntry || builtIn) {
    // Base = the built-in tenant if one exists, else a skeleton derived from
    // THIS host. Never another brand's config: a catalog-only host (osage.id,
    // zoolabs.id) must not inherit Hanzo's issuer or brand package.
    const base = builtIn ?? hostSkeleton(host)
    const merged: TenantConfig = { ...base, ...fromCatalog(catalogEntry) } as TenantConfig
    return normalize(merged)
  }
  const defaultOrg = opts.defaultOrg ?? 'hanzo'
  const fallback = DEFAULT_TENANTS[`${defaultOrg}.id`] ?? DEFAULT_TENANTS['hanzo.id']
  return normalize({ ...fallback, publicOrigin: `https://${host}` })
}

/**
 * A host-derived tenant skeleton for a catalog-only host (no built-in entry).
 * URLs point at the host itself so nothing leaks from another brand; the
 * catalog entry spread over this supplies orgId / clientId / appName /
 * brandPackage. brandPackage defaults empty → the brand loader falls back to a
 * neutral wordmark rather than showing the wrong brand.
 */
function hostSkeleton(host: string): TenantConfig {
  return {
    orgId: '',
    iamUrl: `https://${host}`,
    iamIssuer: `https://${host}`,
    clientId: '',
    appName: '',
    publicOrigin: `https://${host}`,
    brandPackage: '',
  }
}

/**
 * Project a catalog entry onto a TenantConfig patch, mapping `brandUrl` →
 * `brandPackage` (the code-facing field) when an explicit `brandPackage` isn't
 * given. Only defined string fields are emitted, so the host-derived base shows
 * through for anything the entry omits.
 */
function fromCatalog(entry: CatalogEntry | undefined): Partial<TenantConfig> {
  if (!entry) return {}
  const out: Record<string, string> = {}
  for (const k of ['orgId', 'iamUrl', 'iamIssuer', 'clientId', 'appName', 'publicOrigin', 'oauthCallbackOrigin', 'brandPackage'] as const) {
    const v = entry[k]
    if (typeof v === 'string' && v.length > 0) out[k] = v
  }
  if (!out.brandPackage && typeof entry.brandUrl === 'string') {
    const pkg = brandPackageFromUrl(entry.brandUrl)
    if (pkg) out.brandPackage = pkg
  }
  return out as Partial<TenantConfig>
}

/**
 * Extract the npm package name from a CDN brand URL, e.g.
 * `https://cdn.jsdelivr.net/npm/@osage/brand@latest/brand.json` → `@osage/brand`.
 */
function brandPackageFromUrl(url: string): string {
  const m = /\/npm\/(@[^/]+\/[^@/]+|[^@/]+)(?:@|\/)/.exec(url)
  return m ? m[1]! : ''
}

function stripPort(h: string): string {
  return h.replace(/:\d+$/, '')
}

function normalize(t: TenantConfig): TenantConfig {
  const publicOrigin = TRIM_TRAILING_SLASH(t.publicOrigin)
  return {
    ...t,
    iamUrl: TRIM_TRAILING_SLASH(t.iamUrl),
    iamIssuer: TRIM_TRAILING_SLASH(t.iamIssuer || t.iamUrl),
    publicOrigin,
    // The social OAuth hop's redirect_uri must hit the provider's registered
    // callback host. Default to this host; brands sharing a single OAuth client
    // override it (via the catalog) to that client's registered origin.
    oauthCallbackOrigin: TRIM_TRAILING_SLASH(t.oauthCallbackOrigin || publicOrigin),
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
