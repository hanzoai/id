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

/**
 * The org's hosted-ID origin — hanzo.id for hanzo, lux.id for lux, and so on —
 * derived from DEFAULT_TENANTS so the `.id` hosts are declared exactly once.
 * Returns '' for an org with no hosted ID host (local dev, per-host clients).
 */
function idOriginFor(orgId: string): string {
  if (!orgId) return ''
  for (const [host, t] of Object.entries(DEFAULT_TENANTS)) {
    if (t.orgId === orgId && host.endsWith('.id')) return `https://${host}`
  }
  return ''
}

function normalize(t: OrgConfig): OrgConfig {
  const publicOrigin = TRIM_TRAILING_SLASH(t.publicOrigin)
  const iamIssuer = TRIM_TRAILING_SLASH(t.iamIssuer || t.iamUrl)
  return {
    ...t,
    iamUrl: TRIM_TRAILING_SLASH(t.iamUrl),
    iamIssuer,
    publicOrigin,
    // ONE provider callback for the whole fleet, and it is the IAM issuer's.
    //
    // Google and GitHub each accept a FIXED list of redirect URIs, and we hold
    // one shared OAuth client per provider. So every brand must send the SAME
    // redirect_uri or the provider answers `redirect_uri_mismatch` — which is
    // exactly what hanzo.id, hanzo.app and hanzo.chat were all getting.
    //
    // This defaulted to `publicOrigin`, the BRAND'S OWN host, and no catalog
    // entry overrode it. So each property sent a different redirect_uri
    // (hanzo.app/callback, hanzo.chat/callback, console.hanzo.ai/callback …)
    // and social login could work on at most ONE of them — whichever happened
    // to be registered. Every new brand silently arrived broken, and the
    // failure surfaced at Google rather than here, which is why it read as a
    // credentials or KMS problem for days. It never was: the client_id reached
    // Google intact every time.
    //
    // The issuer is the right default because it is the one host the shared
    // client CAN be registered against, it is the same for every brand by
    // construction, and it already serves the headless Callback SPA that
    // completes the exchange and forwards back to the originating app.
    // publicOrigin survives only as a last resort for local dev and per-host
    // clients, where there is no issuer to speak of.
    // ONE provider callback for the whole org, and it is the hosted ID host —
    // hanzo.id for hanzo, lux.id for lux. A social provider must never learn
    // about individual apps: it holds ONE OAuth client with ONE registered
    // redirect_uri, so every app's hop has to arrive from the same origin or
    // the provider answers `redirect_uri_mismatch`.
    //
    // This defaulted to `publicOrigin` — the BRAND'S OWN host — and no catalog
    // entry overrode it, so hanzo.app sent hanzo.app/callback, hanzo.chat sent
    // hanzo.chat/callback, console sent console.hanzo.ai/callback, and social
    // login could work on at most ONE property. Defaulting to `iamIssuer` does
    // NOT fix it: hostSkeleton derives the issuer from the REQUEST HOST too, so
    // it is per-brand for exactly the same reason. It has to be a per-ORG
    // constant, which is what idOriginFor reads out of DEFAULT_TENANTS.
    //
    // The failure surfaced at Google, not here, which is why it read as a
    // credentials or KMS problem for days. It never was: the client_id reached
    // Google intact every time and Google's own error decoded to
    // `redirect_uri_mismatch`.
    //
    // hanzo.id then completes the exchange and forwards the browser back to the
    // originating app, so the app hosts stay entirely invisible to the provider.
    oauthCallbackOrigin: TRIM_TRAILING_SLASH(
      t.oauthCallbackOrigin || idOriginFor(t.orgId) || iamIssuer || publicOrigin,
    ),
  }
}

/**
 * Pull the catalog JSON string out of the `/config.json` payload.
 *
 * The key is the SERVER'S name, not ours: the runtime serves
 * `{"iamTenantConfigJson": "<json>", "v": 1}`. Reading any other key yields
 * `undefined`, App.tsx falls back to a global the runtime never injects, and
 * EVERY catalog-only host silently drops to the bundled defaults — a total
 * catalog outage that looks like nothing at all. That is why this is one named
 * function pinned by tests next to the resolver it feeds, rather than an inline
 * property read at the call site.
 *
 * Restored after c153004 deleted it together with its tests while App.tsx still
 * imported it: the id image failed to build from that commit onward
 * (`"catalogOf" is not exported by "../../pkgs/shared/src/index.ts"`), which is
 * why 0.2.22 never existed. Deleting a function and its tests in one move
 * removes the thing that would have reported the deletion.
 */
export function catalogOf(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const raw = (payload as { iamTenantConfigJson?: unknown }).iamTenantConfigJson
  return typeof raw === 'string' ? raw : undefined
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
