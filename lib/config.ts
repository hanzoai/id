/**
 * Runtime config — single source of truth for tenant resolution.
 *
 * The login portal is white-label: any domain pointing at it gets a working
 * OIDC/OAuth2 experience. Tenants are NEVER hardcoded into source. They
 * resolve in this order at every request:
 *
 *   1. Per-request runtime overrides (Next.js middleware / route handlers
 *      pass the request `host` and read env per call).
 *   2. Browser /config.json (the `ghcr.io/hanzoai/spa` v1.1+ image renders
 *      this at pod startup from SPA_* env vars). Only used in the browser
 *      after `loadConfig()` resolves.
 *   3. Process env (`IAM_URL`, `IAM_ORG`, `IAM_CLIENT_ID`, …).
 *   4. Optional JSON catalog file pointed to by `IAM_TENANT_CONFIG_PATH`
 *      or inlined as `IAM_TENANT_CONFIG_JSON`. Same shape as the
 *      `staticBranding` overlay — useful when one deployment serves many
 *      hosts (Cloudflare Pages, single Docker image with N routes).
 *   5. Hostname derivation (`id.<apex>` → `<apex>`, fall back to host).
 *
 * There is NO compile-time hostname switch. Adding a tenant means writing
 * a CR / ConfigMap, never editing source.
 *
 * Reference convention: ~/work/hanzo/iam/docs/CONVENTION.md §6 (consumer
 * SPAs / Next backends) and §5 (multi-host serving).
 */

export type TenantConfig = {
  /** OAuth2/OIDC backend (IAM) origin, no trailing slash. */
  readonly iamUrl: string
  /** Pinned OIDC issuer claim (defaults to iamUrl). */
  readonly iamIssuer: string
  /** Tenant org slug (JWT `owner` claim). */
  readonly orgId: string
  /** Default OAuth client_id when no `?client_id=` query param is set. */
  readonly clientId: string
  /** Default IAM application name (the underlying `<org>-<app>` slug). */
  readonly appName: string
  /** Canonical public origin for this host (used for OIDC discovery rewrites). */
  readonly publicOrigin: string
}

// --- Defaults ---------------------------------------------------------------

const DEFAULT_LOCAL_IAM = 'http://localhost:8000'
const DEFAULT_PROD_IAM = 'https://iam.hanzo.ai'

function isLocalHost(host: string): boolean {
  return (
    host === 'localhost'
    || host === '127.0.0.1'
    || host.endsWith('.localhost')
    || host.startsWith('localhost:')
    || host.startsWith('127.0.0.1:')
  )
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '')
}

// --- Optional catalog (per-deployment JSON, env-fed) ------------------------

type CatalogEntry = Partial<TenantConfig>
type Catalog = Record<string, CatalogEntry>

let cachedCatalog: Catalog | null = null

/**
 * Read tenant catalog from a Node-side filesystem path. Returns `null` in
 * non-Node runtimes (edge / Cloudflare Workers) or on any error.
 *
 * The `require` is looked up via the `module` global to avoid Webpack
 * tracing `node:fs` into edge bundles — Next.js's Edge runtime guard
 * (`Dynamic Code Evaluation`) is satisfied because we never call `eval`
 * or `new Function`.
 */
function readNodeCatalogFile(path: string): Catalog | null {
  try {
    type Req = (id: string) => unknown
    // `module` is a Node-only global. In Next's Edge bundler this lookup
    // resolves to `undefined` and we exit early.
    const mod = (globalThis as unknown as { module?: { require?: Req } }).module
    const req = mod?.require
    if (typeof req !== 'function') return null
    const fs = req('node:fs') as typeof import('node:fs')
    const data = fs.readFileSync(path, 'utf8')
    const parsed = JSON.parse(data) as unknown
    return (parsed && typeof parsed === 'object') ? (parsed as Catalog) : null
  } catch {
    return null
  }
}

/**
 * Read an optional tenant catalog from env. Two ways to provide it:
 *
 *   IAM_TENANT_CONFIG_JSON='{"hanzo.id":{"orgId":"hanzo","iamUrl":"…"}}'
 *   IAM_TENANT_CONFIG_PATH=/etc/hanzo-id/tenants.json   (Node-only, server-side)
 *
 * JSON > path. Misconfiguration is non-fatal — bad JSON yields an empty
 * catalog so the fallback chain still works.
 */
function getCatalog(): Catalog {
  if (cachedCatalog) return cachedCatalog

  // 1. Inline JSON env (works in edge runtime, Cloudflare Workers, Node).
  if (typeof process !== 'undefined' && process.env) {
    const raw = process.env.IAM_TENANT_CONFIG_JSON
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          cachedCatalog = parsed as Catalog
          return cachedCatalog
        }
      } catch {
        // Bad JSON — fall through.
      }
    }
  }

  // 2. File path: NODE-ONLY. The Next.js Edge runtime and Cloudflare
  //    Workers don't expose `node:fs`, so `readNodeCatalogFile` returns
  //    `null` there and we just fall through. To use the path knob in a
  //    multi-runtime deploy, prefer baking the JSON into
  //    `IAM_TENANT_CONFIG_JSON` (works everywhere).
  if (typeof process !== 'undefined' && process.env?.IAM_TENANT_CONFIG_PATH) {
    const loaded = readNodeCatalogFile(process.env.IAM_TENANT_CONFIG_PATH)
    if (loaded) {
      cachedCatalog = loaded
      return cachedCatalog
    }
  }

  cachedCatalog = {}
  return cachedCatalog
}

// --- Hostname helpers -------------------------------------------------------

/**
 * Strip port + `id.` prefix to get the canonical tenant key.
 * `id.hanzo.ai:443` → `hanzo.ai`, `lux.id` → `lux.id`, `localhost:3000` → `localhost`.
 */
function tenantKey(host: string): string {
  const bare = host.split(':')[0]
  if (bare.startsWith('id.')) return bare.slice(3)
  if (bare.startsWith('iam.')) return bare.slice(4)
  return bare
}

// --- Per-process overrides (server-side env vars) ---------------------------

/**
 * Pure-env defaults — used when there is no catalog entry for the host.
 * These let a single-tenant deploy work with `IAM_URL=… IAM_ORG=… node server.js`.
 */
function envDefaults(host: string): TenantConfig {
  const env = (typeof process !== 'undefined' && process.env) || ({} as NodeJS.ProcessEnv)
  const bareHost = host.split(':')[0]
  const local = isLocalHost(bareHost)

  const iamUrl = trimSlash(
    env.IAM_URL
      ?? env.NEXT_PUBLIC_IAM_URL
      ?? env.IAM_ORIGIN
      ?? (local ? DEFAULT_LOCAL_IAM : DEFAULT_PROD_IAM),
  )

  const orgId = env.IAM_ORG ?? env.NEXT_PUBLIC_ORG ?? 'hanzo'
  const clientId = env.IAM_CLIENT_ID ?? env.NEXT_PUBLIC_CLIENT_ID ?? `${orgId}-id`
  const appName = env.IAM_APP_NAME ?? env.NEXT_PUBLIC_APP_NAME ?? clientId

  const proto = local ? 'http' : 'https'
  const publicOrigin = env.PUBLIC_ORIGIN ?? `${proto}://${host}`

  return {
    iamUrl,
    iamIssuer: trimSlash(env.IAM_ISSUER ?? iamUrl),
    orgId,
    clientId,
    appName,
    publicOrigin,
  }
}

// --- Public API -------------------------------------------------------------

/**
 * Resolve the tenant for a request hostname. Pure function — every consumer
 * (middleware, route handlers, client components after `/config.json` load)
 * passes the request host and gets back a fully-resolved tenant config.
 *
 * Resolution order:
 *   1. Catalog entry keyed by exact host
 *   2. Catalog entry keyed by stripped host (`id.<apex>` → `<apex>`)
 *   3. Env defaults (`envDefaults`)
 *
 * A catalog entry MERGES with env defaults (catalog wins per field), so a
 * minimal entry like `{"foo.id": {"orgId": "foo"}}` still gets an iamUrl
 * from env (or the prod/local default).
 */
export function resolveTenant(host: string): TenantConfig {
  const base = envDefaults(host)
  const catalog = getCatalog()

  const bare = host.split(':')[0]
  const exact = catalog[bare]
  const stripped = catalog[tenantKey(host)]

  const overlay: CatalogEntry = {
    ...(stripped ?? {}),
    ...(exact ?? {}),
  }

  // appName tracks clientId by default — a catalog entry that pins only
  // clientId implicitly pins appName to the same value. Same for orgId,
  // which feeds the env-default clientId. We re-derive in order to keep
  // these invariants stable.
  const orgId = overlay.orgId ?? base.orgId
  const clientId = overlay.clientId
    ?? (overlay.orgId
      ? (typeof process !== 'undefined' && process.env?.IAM_CLIENT_ID)
        || `${orgId}-id`
      : base.clientId)
  const appName = overlay.appName ?? clientId

  const merged: TenantConfig = {
    iamUrl: overlay.iamUrl ? trimSlash(overlay.iamUrl) : base.iamUrl,
    iamIssuer: overlay.iamIssuer
      ? trimSlash(overlay.iamIssuer)
      : (overlay.iamUrl ? trimSlash(overlay.iamUrl) : base.iamIssuer),
    orgId,
    clientId,
    appName,
    publicOrigin: overlay.publicOrigin ?? base.publicOrigin,
  }

  return merged
}

/**
 * Browser SPA helper — reads `/config.json` once, then caches. Use this in
 * client components where `process.env` doesn't carry runtime values.
 *
 * Falls back to `resolveTenant(window.location.host)` when /config.json
 * is missing or has `__TEMPLATE__` placeholders (operator hasn't rendered
 * the ConfigMap yet, or you're running `next dev` standalone).
 */
let browserCache: TenantConfig | null = null

export async function loadBrowserConfig(): Promise<TenantConfig> {
  if (browserCache) return browserCache
  if (typeof window === 'undefined') {
    return resolveTenant('localhost')
  }

  try {
    const res = await fetch('/config.json', { cache: 'no-store' })
    if (res.ok) {
      const raw = (await res.json()) as Partial<TenantConfig> & { v?: number }
      // Reject obviously-templated values.
      const templated = (v?: string): boolean =>
        typeof v !== 'string' || v === '' || v.includes('__TEMPLATE__')
      if (!templated(raw.iamUrl)) {
        const base = resolveTenant(window.location.host)
        browserCache = {
          iamUrl: trimSlash(raw.iamUrl as string),
          iamIssuer: trimSlash(raw.iamIssuer ?? raw.iamUrl as string),
          orgId: raw.orgId ?? base.orgId,
          clientId: raw.clientId ?? base.clientId,
          appName: raw.appName ?? base.appName,
          publicOrigin: raw.publicOrigin ?? base.publicOrigin,
        }
        return browserCache
      }
    }
  } catch {
    // Network / parse error — fall through to hostname-based fallback.
  }

  browserCache = resolveTenant(window.location.host)
  return browserCache
}

/**
 * Synchronous browser accessor — call `loadBrowserConfig()` first if you
 * need /config.json values. Otherwise this returns the hostname-derived
 * fallback (works for "just clone, pnpm dev" without a SPA container).
 */
export function getBrowserConfig(): TenantConfig {
  if (browserCache) return browserCache
  if (typeof window === 'undefined') {
    browserCache = resolveTenant('localhost')
    return browserCache
  }
  browserCache = resolveTenant(window.location.host)
  return browserCache
}

/** Test-only reset (catalog + browser cache). */
export function _resetForTests(): void {
  cachedCatalog = null
  browserCache = null
}
