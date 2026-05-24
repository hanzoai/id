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

const DEFAULT_TENANTS: Record<string, TenantConfig> = {
  'hanzo.id': {
    orgId: 'hanzo',
    iamUrl: 'https://iam.hanzo.ai',
    iamIssuer: 'https://hanzo.id',
    clientId: 'id-portal-portal',
    appName: 'hanzo-id',
    publicOrigin: 'https://hanzo.id',
    brandPackage: '@hanzo/brand',
  },
  'lux.id': {
    orgId: 'lux',
    iamUrl: 'https://iam.hanzo.ai',
    iamIssuer: 'https://lux.id',
    clientId: 'lux-id-portal',
    appName: 'lux-id',
    publicOrigin: 'https://lux.id',
    brandPackage: '@luxfi/brand',
  },
  // Lux secondary identity hosts — share the lux brand + IAM org.
  'id.lux.network': {
    orgId: 'lux',
    iamUrl: 'https://iam.hanzo.ai',
    iamIssuer: 'https://id.lux.network',
    clientId: 'lux-id-portal',
    appName: 'lux-id',
    publicOrigin: 'https://id.lux.network',
    brandPackage: '@luxfi/brand',
  },
  'iam.lux.network': {
    orgId: 'lux',
    iamUrl: 'https://iam.hanzo.ai',
    iamIssuer: 'https://iam.lux.network',
    clientId: 'lux-id-portal',
    appName: 'lux-id',
    publicOrigin: 'https://iam.lux.network',
    brandPackage: '@luxfi/brand',
  },
  'zoo.id': {
    orgId: 'zoo',
    iamUrl: 'https://iam.hanzo.ai',
    iamIssuer: 'https://zoo.id',
    clientId: 'zoo-id-portal',
    appName: 'zoo-id',
    publicOrigin: 'https://zoo.id',
    brandPackage: '@zooai/brand',
  },
  // Zoo secondary identity host — same brand + IAM org as zoo.id.
  'id.zoo.network': {
    orgId: 'zoo',
    iamUrl: 'https://iam.hanzo.ai',
    iamIssuer: 'https://id.zoo.network',
    clientId: 'zoo-id-portal',
    appName: 'zoo-id',
    publicOrigin: 'https://id.zoo.network',
    brandPackage: '@zooai/brand',
  },
  'pars.id': {
    orgId: 'pars',
    iamUrl: 'https://iam.hanzo.ai',
    iamIssuer: 'https://pars.id',
    clientId: 'pars-id-portal',
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
