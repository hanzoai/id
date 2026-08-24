import type { Org } from './types'

/**
 * Resolve an Org by hostname.
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
 * `clientId` MUST name the SAME application the runtime catalog names for that
 * host. This table is a fallback for a failed `/config.json`, not a second
 * opinion — `resolveOrg` spreads the catalog OVER it, so any key where the two
 * disagree makes the host authenticate as one app or the other depending on
 * whether a network fetch won a race.
 *
 * That is not hypothetical. `hanzo.id` said `hanzo-id` here while the catalog
 * says `hanzo-console`, and the two differ in `enableSignUp` — false vs true.
 * So on a load where `/config.json` did not arrive, hanzo.id authenticated as
 * `hanzo-id`, the signup form rendered, and the POST came back "the application
 * does not allow to sign up new account". Intermittent, device-dependent, and
 * indistinguishable from a bad password to the person hitting it. Reported from
 * a phone, where a dropped request is ordinary.
 *
 * Both now match the catalog (`universe/infra/k8s/id/configmap.yaml`,
 * SPA_IAM_TENANT_CONFIG_JSON). `org.test.ts` pins them, so a future edit to one
 * side has to confront the other. Fixing the fallback to be SURVIVABLE was the
 * wrong shape — the fix is that there is only one answer per host.
 */
const DEFAULT_TENANTS: Record<string, Org> = {
  'hanzo.id': {
    orgId: 'hanzo',
    iamUrl: 'https://hanzo.id',
    iamIssuer: 'https://hanzo.id',
    clientId: 'hanzo-console',
    appName: 'hanzo-console',
    publicOrigin: 'https://hanzo.id',
    brandPackage: '@hanzo/brand',
  },
  'lux.id': {
    orgId: 'lux',
    iamUrl: 'https://lux.id',
    iamIssuer: 'https://lux.id',
    clientId: 'lux-cloud',
    appName: 'lux-cloud',
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
export type CatalogEntry = Partial<Org> & {
  /** CDN URL of the brand package, e.g. `…/npm/@osage/brand@latest/brand.json`. */
  readonly brandUrl?: string
}

/** Every host this portal answers on, keyed by hostname. */
export type Catalog = Record<string, CatalogEntry>

export interface ResolveOptions {
  /** Optional runtime catalog (parsed from IAM_TENANT_CONFIG_JSON or /config.json). */
  readonly catalog?: Catalog
}

export function resolveOrg(hostname: string, opts: ResolveOptions = {}): Org {
  const host = stripPort(hostname).toLowerCase()
  const catalogEntry = opts.catalog?.[host]
  const builtIn = DEFAULT_TENANTS[host]
  if (catalogEntry || builtIn) {
    // Base = the built-in org if one exists, else a skeleton derived from
    // THIS host. Never another brand's config: a catalog-only host (osage.id,
    // zoolabs.id) must not inherit Hanzo's issuer or brand package.
    const base = builtIn ?? hostSkeleton(host)
    const merged: Org = { ...base, ...fromCatalog(catalogEntry) } as Org
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
function hostSkeleton(host: string): Org {
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
 * Project a catalog entry onto an Org patch, mapping `brandUrl` →
 * `brandPackage` (the code-facing field) when an explicit `brandPackage` isn't
 * given. Only defined string fields are emitted, so the host-derived base shows
 * through for anything the entry omits.
 */
function fromCatalog(entry: CatalogEntry | undefined): Partial<Org> {
  if (!entry) return {}
  const out: Record<string, string> = {}
  // THIS LIST IS THE RUNTIME CONTRACT, and adding a field to Org without
  // adding it here is a field that type-checks, reads correctly at every call
  // site, and is silently empty in the browser — the shape of the
  // iamTenantConfigJson miss, where a rename left a live read pointing at a key
  // nothing emitted and nothing logged a thing.
  for (const k of [
    'orgId',
    'loginOrg',
    'iamUrl',
    'iamIssuer',
    'clientId',
    'appName',
    'publicOrigin',
    'brandPackage',
    'payUrl',
    'termsUrl',
    'privacyUrl',
  ] as const) {
    const v = entry[k]
    if (typeof v === 'string' && v.length > 0) out[k] = v
  }
  if (!out.brandPackage && typeof entry.brandUrl === 'string') {
    const pkg = brandPackageFromUrl(entry.brandUrl)
    if (pkg) out.brandPackage = pkg
  }
  return out as Partial<Org>
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
 * The one host an org's people sign in on — its front door.
 *
 * An org reaches this portal on several hostnames: a front door (`lux.id`) and
 * aliases kept for history or for the backend's sake (`id.lux.network`,
 * `iam.lux.network`). Every one of them renders a complete, working login page,
 * so an alias is not broken — it is a SECOND front door, and a second front door
 * is a second thing to brand, register with a provider, and remember.
 *
 * Which host is the front door is a fact about the ORG, and the catalog is keyed
 * by HOST, so the catalog states it the only way a host-keyed table can: one
 * entry per org says `"canonical": true`. Read from the catalog rather than
 * guessed, because guessing is what was here before — a scan of DEFAULT_TENANTS
 * for a host ending in `.id`, which silently returned NOTHING for zoo (whose
 * front door is `zoolabs.id` and which has no DEFAULT_TENANTS entry at all).
 * A rule that is quietly a no-op for one brand out of five is worse than no rule.
 *
 * Returns '' when the org names no front door — local dev, an unregistered host,
 * or `bootnode`, whose only host IS its front door. '' means "stay here".
 */
export function frontDoor(catalog: Catalog, orgId: string): string {
  if (!orgId) return ''
  for (const [host, e] of Object.entries(catalog)) {
    if (e?.canonical && e.orgId === orgId) return `https://${stripPort(host)}`
  }
  return ''
}

/**
 * Where to send a visitor who arrived on an alias, or null to serve them here.
 *
 * Path and query travel verbatim: a sign-in carries the whole OAuth request
 * (client_id, redirect_uri, state, PKCE) and dropping it would strand the app
 * that sent them.
 *
 * `/callback` NEVER moves. A provider returns the browser to the exact URI it
 * was given, so that page has to complete on whatever host received it —
 * redirecting it would discard the code mid-exchange.
 *
 * Same-host is null rather than a self-redirect, which is what keeps this from
 * looping: the front door's own entry resolves to itself and stops.
 */
export function aliasRedirect(
  catalog: Catalog,
  orgId: string,
  origin: string,
  pathname: string,
  search: string,
): string | null {
  if (pathname === '/callback' || pathname.startsWith('/callback/')) return null
  const door = frontDoor(catalog, orgId)
  if (!door || door === TRIM_TRAILING_SLASH(origin)) return null
  return `${door}${pathname}${search}`
}

function normalize(t: Org): Org {
  const publicOrigin = TRIM_TRAILING_SLASH(t.publicOrigin)
  const iamIssuer = TRIM_TRAILING_SLASH(t.iamIssuer || t.iamUrl)
  return {
    ...t,
    iamUrl: TRIM_TRAILING_SLASH(t.iamUrl),
    iamIssuer,
    publicOrigin,
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
export function parseCatalog(raw: string | undefined | null): Record<string, Partial<Org>> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}
