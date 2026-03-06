/**
 * IAM backend URL resolution.
 *
 * Maps the login portal domain to the correct IAM backend.
 * Configurable via env vars for self-hosted deployments.
 */

// Default domain → IAM URL mapping
const IAM_URLS: Record<string, string> = {
  'hanzo.id': 'https://iam.hanzo.ai',
  'id.hanzo.ai': 'https://iam.hanzo.ai',
  'lux.id': 'https://iam.lux.network',
  'zoo.id': 'https://iam.zoo.network',
  'pars.id': 'https://iam.pars.network',
  'zen.id': 'https://iam.hanzo.ai',
  'id.ad.nexus': 'https://iam.hanzo.ai',
}

// Default domain → org mapping
const ORG_MAP: Record<string, string> = {
  'hanzo.id': 'hanzo',
  'id.hanzo.ai': 'hanzo',
  'lux.id': 'lux',
  'zoo.id': 'zoo',
  'pars.id': 'pars',
  'zen.id': 'zen',
  'id.ad.nexus': 'adnexus',
}

// Default domain → default app clientId
const APP_MAP: Record<string, string> = {
  'hanzo.id': 'app-hanzo',
  'id.hanzo.ai': 'app-hanzo',
  'lux.id': 'lux-app-client-id',
  'zoo.id': 'zoo-app-client-id',
  'pars.id': 'pars-app-client-id',
  'zen.id': 'zen-app-client-id',
  'id.ad.nexus': 'adnexus-app-client-id',
}

export function getIamUrl(host: string): string {
  const domain = host.split(':')[0]

  // 1. Check env override (for self-hosted / K8s)
  if (typeof process !== 'undefined') {
    const envUrl = process.env.NEXT_PUBLIC_IAM_URL || process.env.HANZO_IAM_URL
    if (envUrl) return envUrl
  }

  // 2. Static map
  return IAM_URLS[domain] ?? 'https://iam.hanzo.ai'
}

export function getOrg(host: string): string {
  const domain = host.split(':')[0]
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_ORG) {
    return process.env.NEXT_PUBLIC_ORG
  }
  return ORG_MAP[domain] ?? 'hanzo'
}

export function getDefaultClientId(host: string): string {
  const domain = host.split(':')[0]
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_CLIENT_ID) {
    return process.env.NEXT_PUBLIC_CLIENT_ID
  }
  return APP_MAP[domain] ?? 'app-hanzo'
}
