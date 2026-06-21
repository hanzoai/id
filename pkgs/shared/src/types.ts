/**
 * Per-tenant configuration resolved at runtime.
 *
 * One image, many hosts. The portal resolves a TenantConfig for each
 * incoming request by hostname; the IAM backend, OAuth client id, and
 * brand package are all wired from this single object.
 */
export interface TenantConfig {
  /** Tenant org slug (matches the JWT `owner` claim and the IAM `<org>-<app>` namespace). */
  readonly orgId: string
  /** IAM (OIDC) backend origin, no trailing slash. */
  readonly iamUrl: string
  /** Pinned OIDC issuer claim. Defaults to iamUrl. */
  readonly iamIssuer: string
  /** Default OAuth client_id (used when the request has no `?client_id=` param). */
  readonly clientId: string
  /** Underlying IAM application slug. */
  readonly appName: string
  /** Canonical public origin for the host (used for OIDC discovery rewrites). */
  readonly publicOrigin: string
  /** npm package name of the brand pkg to load (e.g. `@hanzo/brand`). */
  readonly brandPackage: string
  /**
   * Allow self-service account creation. Defaults to true (undefined = true).
   * Set false for invite-only / admin-provisioned tenants: the `/signup` route
   * falls back to `/login` and every "Create account" link is hidden.
   */
  readonly signupEnabled?: boolean
  /** Optional absolute URL to brand.json (e.g. a jsDelivr-hosted copy from
   *  config.json). Preferred over the app-local /brand/<pkg>/brand.json. */
  readonly brandUrl?: string
}

/**
 * Brand contract that all per-org brand packages MUST satisfy.
 * Matches the consumer contract in `@hanzo/brand` / `@luxfi/brand` /
 * `@zooai/brand` / `@parsdao/brand`. Read from each pkg's `brand.json`.
 */
export interface BrandContract {
  /** Org display name shown in headings ("Hanzo", "Lux", "Zoo", "Pars"). */
  readonly name: string
  /** Browser tab title prefix. */
  readonly title: string
  /** Short tagline rendered on the portal hero. */
  readonly description: string
  /** Marketing site (footer link target). */
  readonly appDomain: string
  /** Logo + favicon URLs (CDN or data URI). */
  readonly logoUrl: string
  readonly faviconUrl: string
  /** Primary accent (CSS color string, e.g. "#ff6b35" or "var(--brand)"). */
  readonly accentColor?: string
  /** Optional social links rendered in the footer. */
  readonly twitter?: string
  readonly github?: string
  readonly discord?: string
}
