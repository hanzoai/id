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
   * This host is the org's front door — the one its people sign in on.
   *
   * At most one entry per org sets it. Every other host for that org is an
   * alias and redirects here, carrying its path and query (see `aliasRedirect`).
   * An org that sets it nowhere has no front door and every host stays put,
   * which is the right answer for a single-host brand and for local dev.
   *
   * It is a fact about the ORG stated in a table keyed by HOST, which is why it
   * is a flag on one entry rather than a map somewhere else: the hosts are
   * already declared here, exactly once, and a second table would be a second
   * thing to keep in step.
   */
  readonly canonical?: boolean
  /** npm package name of the brand pkg to load (e.g. `@hanzo/brand`). */
  readonly brandPackage: string
  /** Optional absolute URL to brand.json (e.g. a jsDelivr-hosted copy from
   *  config.json). Preferred over the app-local /brand/<pkg>/brand.json. */
  readonly brandUrl?: string
  /**
   * Pay origin for this brand — the top-up / plan-purchase surface and its
   * billing catalog (`GET <payUrl>/v1/billing/plans`). Onboarding's plan step
   * reads the catalog from here and hands off to it after the choice. Defaults
   * to `https://pay.hanzo.ai`; a white-label brand sets its own in the runtime
   * catalog. NO trailing slash. */
  readonly payUrl?: string
  /**
   * The brand's terms and privacy documents, linked from the footer beside the
   * copyright.
   *
   * Both are OPTIONAL and the footer renders each only when it is set, because
   * the alternative is worse than a missing link: neither the brand contract nor
   * this config carries a legal document today, so the only way to show them
   * unconditionally is to derive a path — `${publicOrigin}/terms` — and this
   * portal serves no such route on any brand. That is a 404 on the one link a
   * consumer surface is most often REQUIRED to get right, and it would read as
   * ours rather than as missing config.
   *
   * Absolute URLs, because a brand's legal pages generally live on its marketing
   * site rather than on its identity host. Set per brand in the runtime catalog
   * (`id-tenant-catalog`), so adding them needs no rebuild.
   */
  readonly termsUrl?: string
  readonly privacyUrl?: string
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
