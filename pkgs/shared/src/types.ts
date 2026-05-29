/**
 * Per-tenant configuration resolved at runtime.
 *
 * One image, many hosts. The portal resolves a TenantConfig for each
 * incoming request by hostname; the IAM backend, OAuth client id, and
 * brand contract URL are all wired from this single object.
 *
 * NOTHING in this repo is brand-specific. Built-in defaults are derived
 * from the hostname (e.g. `foo.id` → orgId=`foo`). Any non-derivable
 * value (npm scope mismatch like `lux` → `@luxfi/brand`, custom clientId,
 * etc.) is supplied at deploy time via the runtime catalog.
 */
export interface TenantConfig {
  /** Tenant org slug (matches the JWT `owner` claim and the IAM `<org>-<app>` namespace). */
  readonly orgId: string
  /** IAM (OIDC) backend origin, no trailing slash. Defaults to same-origin. */
  readonly iamUrl: string
  /** Pinned OIDC issuer claim. Defaults to `https://<hostname>`. */
  readonly iamIssuer: string
  /** Default OAuth client_id (used when the request has no `?client_id=` param). */
  readonly clientId: string
  /** Underlying IAM application slug. */
  readonly appName: string
  /** Canonical public origin for the host. */
  readonly publicOrigin: string
  /** Absolute URL to the brand contract's `brand.json` (npm CDN, brand-owned host, anywhere). */
  readonly brandUrl: string
}

/**
 * Brand contract that any brand pkg MUST satisfy.
 * Read at runtime from the URL specified by `TenantConfig.brandUrl`.
 */
export interface BrandContract {
  /** Org display name shown in headings ("Hanzo", "Lux", "Zoo", "Pars", ...). */
  readonly name: string
  /** Browser tab title prefix. */
  readonly title: string
  /** Short tagline rendered on the portal hero. */
  readonly description: string
  /** Marketing site (footer link target). */
  readonly appDomain: string
  /** Logo + favicon URLs (absolute — CDN or data URI). */
  readonly logoUrl: string
  readonly faviconUrl: string
  /** Primary accent (CSS color string, e.g. "#ff6b35" or "var(--brand)"). */
  readonly accentColor?: string
  /** Optional social links rendered in the footer. */
  readonly twitter?: string
  readonly github?: string
  readonly discord?: string
}
