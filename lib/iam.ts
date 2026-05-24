/**
 * IAM backend URL / org / clientId resolution.
 *
 * Thin compatibility wrapper around `lib/config.ts::resolveTenant`. Use the
 * tenant resolver directly in new code — these accessors exist so the
 * existing login/signup/forgot-password components keep working.
 *
 * No hardcoded hostname → IAM URL map lives here. See `lib/config.ts` for
 * the resolution chain (catalog → env → host-derived fallback) and
 * `~/work/hanzo/iam/docs/CONVENTION.md` for the canonical convention.
 */

import { resolveTenant, getBrowserConfig } from './config'

/**
 * Return the IAM origin for a request host.
 * Server-side: resolved via `resolveTenant(host)`.
 * Client-side: ignores `host` and reads the cached browser config (set by
 * `loadBrowserConfig()` at app boot from `/config.json`).
 */
export function getIamUrl(host: string): string {
  if (typeof window === 'undefined') {
    return resolveTenant(host).iamUrl
  }
  return getBrowserConfig().iamUrl
}

/** Return the org slug for a request host. Same resolution as `getIamUrl`. */
export function getOrg(host: string): string {
  if (typeof window === 'undefined') {
    return resolveTenant(host).orgId
  }
  return getBrowserConfig().orgId
}

/**
 * Return the default OAuth client_id for a request host — used when there
 * is no `?client_id=` query param (direct login flow).
 */
export function getDefaultClientId(host: string): string {
  if (typeof window === 'undefined') {
    return resolveTenant(host).clientId
  }
  return getBrowserConfig().clientId
}
