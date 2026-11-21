import type { OrgConfig } from './types'

/**
 * Resolve a OrgConfig by hostname.
 *
 * Resolution order (first hit wins):
 *   1. `IAM_TENANT_CONFIG_JSON` runtime catalog (set in K8s ConfigMap, served
 *      to the browser via `/config.json` at pod startup).
 *   2. Built-in defaults, for the identity hosts that have one.
 *   3. A skeleton derived from the REQUESTED HOST — never another brand.
 *
 * There is deliberately no cross-brand default. An unknown host resolves to
 * itself with an empty clientId and fails closed, because the alternative is a
 * visitor on one brand's host being shown another brand's login and posting
 * credentials there.
 *
 * No hardcoded hostname switches anywhere downstream. Adding a org
 * means editing the runtime catalog, never editing source.
 */

const TRIM_TRAILING_SLASH = (s: string): string => s.replace(/\/+$/, '')

/**
 * Built-in orgs for the four canonical identity hosts.
 *
 * `iamUrl` is the per-brand OIDC ISSUER — the host that serves
 * `/.well-known/openid-configuration` and the `/v1/iam/*` surface. Per
 * HIP-0111 this is the brand's own `*.id` host (hanzo.id / lux.id / …),
 * NOT `iam.hanzo.ai`: discovery must be host-relative so the SDK never
 * resolves to the wrong origin (or the IAM SPA HTML catch-all). The IAM
 * backend org-scopes on the `organization` body param; one backend
 * serves every brand behind its own issuer host.
 *
 * `clientId` is the brand `-id` app registered in `init_data.json`
 * (`hanzo-id`, `lux-id`, …) so the portal authenticates as that app — the
 * same app whose enabled providers (password + GitHub + Google + Web3)
 * `get-app-login` reports.
 */
const DEFAULT_TENANTS: Record<string, OrgConfig> = {
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
export type CatalogEntry = Partial<OrgConfig> & {
  /** CDN URL of the brand package, e.g. `…/npm/@osage/brand@latest/brand.json`. */
  readonly brandUrl?: string
}

export interface ResolveOptions {
  /** Optional runtime catalog (parsed from IAM_TENANT_CONFIG_JSON or /config.json). */
  readonly catalog?: Record<string, CatalogEntry>
}

export function resolveOrg(hostname: string, opts: ResolveOptions = {}): OrgConfig {
  const host = stripPort(hostname).toLowerCase()
  const catalogEntry = opts.catalog?.[host]
  const builtIn = DEFAULT_TENANTS[host]
  if (catalogEntry || builtIn) {
    // Base = the built-in org if one exists, else a skeleton derived from
    // THIS host. Never another brand's config: a catalog-only host (osage.id,
    // zoolabs.id) must not inherit Hanzo's issuer or brand package.
    const base = builtIn ?? hostSkeleton(host)
    const merged: OrgConfig = { ...base, ...fromCatalog(catalogEntry) } as OrgConfig
    return normalize(merged)
  }
  // Unknown host → derive from the host ITSELF. Never another brand's org.
  //
  // This used to return DEFAULT_TENANTS[`${defaultOrg}.id`], i.e. Hanzo's. Eight
  // real hosts have no built-in entry and live only in the runtime catalog —
  // zoolabs.id, www.zoolabs.id, id.zoo.network, id.lux.network, iam.lux.network,
  // id.pars.network, id.bootno.de, iam.hanzo.ai — and App.tsx deliberately
  // tolerates a failed /config.json fetch. So whenever that fetch failed, a Zoo,
  // Lux, Pars or Bootnode visitor was handed orgId `hanzo`, `@hanzo/brand` and
  // iamUrl `https://hanzo.id`: shown "Sign in to Hanzo ID" under the Hanzo mark
  // and POSTING THEIR CREDENTIALS AT hanzo.id. The comment ten lines up already
  // promised this could not happen ("Never another brand's config") — it held
  // only while the catalog loaded.
  //
  // The skeleton carries an empty clientId, so the portal fails closed rather
  // than silently authenticating as some other brand's IAM application. A login
  // page that cannot resolve its org must refuse, not guess.
  return normalize(hostSkeleton(host))
}

/**
 * A host-derived org skeleton for a catalog-only host (no built-in entry).
 * URLs point at the host itself so nothing leaks from another brand; the
 * catalog entry spread over this supplies orgId / clientId / appName /
 * brandPackage. brandPackage defaults empty → the brand loader falls back to a
 * neutral wordmark rather than showing the wrong brand.
 */
function hostSkeleton(host: string): OrgConfig {
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
 * Project a catalog entry onto a OrgConfig patch, mapping `brandUrl` →
 * `brandPackage` (the code-facing field) when an explicit `brandPackage` isn't
 * given. Only defined string fields are emitted, so the host-derived base shows
 * through for anything the entry omits.
 */
function fromCatalog(entry: CatalogEntry | undefined): Partial<OrgConfig> {
  if (!entry) return {}
  const out: Record<string, string> = {}
  for (const k of ['orgId', 'loginOrg', 'iamUrl', 'iamIssuer', 'clientId', 'appName', 'publicOrigin', 'oauthCallbackOrigin', 'brandPackage'] as const) {
    const v = entry[k]
    if (typeof v === 'string' && v.length > 0) out[k] = v
  }
  if (!out.brandPackage && typeof entry.brandUrl === 'string') {
    const pkg = brandPackageFromUrl(entry.brandUrl)
    if (pkg) out.brandPackage = pkg
  }
  return out as Partial<OrgConfig>
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

function normalize(t: OrgConfig): OrgConfig {
  const publicOrigin = TRIM_TRAILING_SLASH(t.publicOrigin)
  return {
    ...t,
    iamUrl: TRIM_TRAILING_SLASH(t.iamUrl),
    iamIssuer: TRIM_TRAILING_SLASH(t.iamIssuer || t.iamUrl),
    publicOrigin,
    // NO DEFAULT, deliberately. The social hop's `redirect_uri` must be an
    // origin the PROVIDER has registered, and providers register exactly one:
    // the IAM backend's (`https://iam.hanzo.ai`), shared across every brand
    // portal. This host is not that origin except by accident, so `publicOrigin`
    // is not a fallback — it is a guaranteed `Error 400: redirect_uri_mismatch`
    // at Google, produced silently, at the provider, after the user has already
    // clicked. Defaulting to it turned "the catalog did not load" into "Google
    // sign-in is broken on every surface" with nothing to read anywhere.
    //
    // So an unset value stays UNSET and the callers refuse: `buildProviderAuthUrl`
    // throws rather than build a URL it knows the provider will reject, and
    // `SocialButtons` hides the OAuth entries the same way it hides providers
    // IAM holds no credential for. Only the catalog can supply this.
    oauthCallbackOrigin: t.oauthCallbackOrigin ? TRIM_TRAILING_SLASH(t.oauthCallbackOrigin) : undefined,
  }
}

/**
 * Pull the catalog JSON out of the `/config.json` document the runtime serves.
 *
 * THE WIRE KEY IS NOT OURS TO NAME. `hanzoai/spa` templates each `SPA_*` env
 * var into `/config.json` as its camelCase tail, and the catalog is delivered in
 * the `id-tenant-catalog` ConfigMap as **`SPA_IAM_TENANT_CONFIG_JSON`** — so the
 * served key is **`iamTenantConfigJson`**, whatever this repo calls the concept
 * internally. Renaming the reader to match an internal rename (tenant → org)
 * silently detached the SPA from its own catalog: the fetch still returned 200,
 * the key read `undefined`, and every host fell back to the built-in defaults —
 * which is how hanzo.id came to authenticate as `hanzo-id` and send Google a
 * `redirect_uri` of `https://hanzo.id/callback`.
 *
 * This function is the ONE place that name appears, and `org.test.ts` pins it
 * against the live document, so the coupling is greppable and cannot drift
 * unnoticed again.
 */
export function catalogJsonFrom(config: unknown): string | undefined {
  if (!config || typeof config !== 'object') return undefined
  const raw = (config as Record<string, unknown>).iamTenantConfigJson
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

/** Parse the runtime catalog JSON safely; returns {} on any error. */
export function parseCatalog(raw: string | undefined | null): Record<string, Partial<OrgConfig>> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}
