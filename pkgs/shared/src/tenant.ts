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
    clientId: 'pars-id',
    appName: 'pars-id',
    publicOrigin: 'https://pars.id',
    brandPackage: '@parsdao/brand',
  },
}

export interface ResolveOptions {
  /** Optional runtime catalog (parsed from IAM_TENANT_CONFIG_JSON or /config.json). */
  readonly catalog?: Record<string, Partial<TenantConfig>>
  /** Default org slug when host has no entry. */
  readonly defaultOrg?: string
}

export function resolveTenant(hostname: string, opts: ResolveOptions = {}): TenantConfig {
  const host = stripPort(hostname).toLowerCase()
  const catalogEntry = opts.catalog?.[host]
  const builtIn = DEFAULT_TENANTS[host]
  if (catalogEntry || builtIn) {
    const merged: TenantConfig = {
      ...(builtIn ?? DEFAULT_TENANTS['hanzo.id']),
      ...(catalogEntry ?? {}),
    } as TenantConfig
    return normalize(merged)
  }
  const defaultOrg = opts.defaultOrg ?? 'hanzo'
  const fallback = DEFAULT_TENANTS[`${defaultOrg}.id`] ?? DEFAULT_TENANTS['hanzo.id']
  return normalize({ ...fallback, publicOrigin: `https://${host}` })
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
