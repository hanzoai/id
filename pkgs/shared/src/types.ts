/**
 * Per-org configuration resolved at runtime.
 *
 * One image, many hosts. The portal resolves a OrgConfig for each
 * incoming request by hostname; the IAM backend, OAuth client id, and
 * brand package are all wired from this single object.
 */
export interface OrgConfig {
  /** Org org slug (matches the JWT `owner` claim and the IAM `<org>-<app>` namespace). */
  readonly orgId: string
  /**
   * OPTIONAL org-resolution anchor for PASSWORD LOGIN only. Unset (the default)
   * = org-agnostic: the SPA posts NO `organization`, IAM resolves the user
   * cross-org by credentials, and the session encodes the user's REAL owner-org
   * (a global admin → the `admin` org / full multi-org session; a brand user →
   * their own org). Pinning `orgId` here would resolve a colliding brand-org row
   * and truncate a global admin to a single org — so the portal leaves this
   * unset. Set it ONLY for a brand that deliberately scopes its portal login to
   * one org. Does NOT affect signup (which always targets `orgId`) or the
   * apps launcher (which is brand-scoped by `orgId`).
   */
  readonly loginOrg?: string
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
  /**
   * Origin whose `/callback` is registered as the social OAuth providers'
   * authorized redirect URI. The shared GitHub/Google OAuth clients are
   * registered against ONE callback host — the IAM backend (`iam.hanzo.ai`) —
   * so the provider hop MUST send `redirect_uri=<oauthCallbackOrigin>/callback`
   * or the provider rejects it with `redirect_uri_mismatch`. That host serves
   * the same headless `Callback` SPA, which completes the exchange and forwards
   * back to the originating app.
   *
   * OPTIONAL, and it has NO DEFAULT — `resolveOrg` leaves it unset when the
   * catalog omits it. It once defaulted to `publicOrigin`, which reads as a
   * sensible per-host fallback and is not one: a provider accepts only the
   * origins registered on its client, and this host is not among them, so the
   * "fallback" is a `redirect_uri_mismatch` the user meets at Google. Unset
   * therefore means SOCIAL LOGIN IS NOT CONFIGURED for this host — the buttons
   * hide and the hop throws — rather than a value to invent. NO trailing slash. */
  readonly oauthCallbackOrigin?: string
  /** npm package name of the brand pkg to load (e.g. `@hanzo/brand`). */
  readonly brandPackage: string
  /** Optional absolute URL to brand.json (e.g. a jsDelivr-hosted copy from
   *  config.json). Preferred over the app-local /brand/<pkg>/brand.json. */
  readonly brandUrl?: string
}

/**
 * Brand contract that all per-org brand packages MUST satisfy — the shape the
 * portal reads from each pkg's `brand.json` (`@hanzo/brand` / `@luxfi/brand` /
 * `@zooai/brand` / `@parsdao/brand`).
 *
 * DRY: this type is NO LONGER defined here. `@hanzo/brand` is the canonical
 * home (`toBrandContract` projects the registry onto exactly this shape); we
 * re-export it so there is one contract, not two that can drift.
 */
export type { BrandContract } from '@hanzo/brand/registry'
