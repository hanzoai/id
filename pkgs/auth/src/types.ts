export interface LoginRequest {
  readonly identifier: string
  readonly password: string
  readonly clientId: string
  readonly application: string
  /**
   * Org-resolution anchor for the credential lookup. OPTIONAL by design.
   *
   * IAM resolves the user by (org, identifier); if the in-org lookup misses it
   * falls back to a CROSS-ORG lookup by email/username and the session always
   * encodes the user's REAL owner-org (`GetOrganizationByUser`), never this
   * value. So this field is a lookup HINT, not the session's org.
   *
   * Leaving it empty/undefined makes login ORG-AGNOSTIC: every in-org lookup
   * misses, the cross-org fallback runs, and an identity that lives in the
   * global `admin` org (a global admin) resolves to `admin` (→ full multi-org
   * session) while a brand-only identity resolves to its own brand org. This is
   * why the portal does NOT pin the brand org here — pinning `hanzo` would
   * resolve a colliding `hanzo/<name>` row and truncate a global admin to one
   * org. Set it only to FORCE a specific tenant (e.g. a brand that deliberately
   * scopes its portal to a single org). Signup, by contrast, MUST carry a
   * concrete org (you cannot create a user in "no org").
   */
  readonly organization?: string
  readonly redirectUri?: string
  readonly state?: string
  readonly codeChallenge?: string
  readonly codeChallengeMethod?: 'S256' | 'plain'
  /**
   * OIDC nonce from the downstream authorize request. MUST be threaded through
   * the password-login path so the minted code (and resulting id_token) echo it.
   * Confidential OIDC clients that validate strictly (e.g. LibreChat /
   * openid-client with OPENID_REUSE_TOKENS) reject an id_token whose nonce
   * doesn't match the one they sent -> "unexpected JWT claim value" -> callback
   * 500. Forward, never default — only echo what the authorize URL carried.
   */
  readonly nonce?: string
}

/**
 * Inputs to {@link AuthClient.silentLogin} — the silent-SSO leg.
 *
 * Carries NO credentials. When the browser already holds an `iam_session_id`
 * cookie on the issuer host (the user signed in once for another app), IAM's
 * Login handler takes its "already signed in" branch and mints an authorization
 * code for `application` without a password or a provider hop. This is what
 * makes the 2nd/3rd app log in seamlessly. With no live session IAM returns an
 * error and the caller falls back to the interactive login form.
 */
export interface SilentLoginRequest {
  /** OAuth client id of the requesting app (== application name in Hanzo IAM). */
  readonly clientId: string
  /** IAM application name the code is minted for. */
  readonly application: string
  /** The requesting app's OAuth redirect_uri — the code is appended to it. */
  readonly redirectUri: string
  readonly state?: string
  readonly scope?: string
  readonly codeChallenge?: string
  readonly codeChallengeMethod?: 'S256' | 'plain'
  /** OIDC nonce, echoed into the minted code -> id_token (strict consumers). */
  readonly nonce?: string
}

/** A multi-factor channel the portal can render a code entry for. */
export type MfaChannel = 'totp' | 'sms' | 'email'

export interface LoginResponse {
  readonly accessToken?: string
  readonly refreshToken?: string
  readonly idToken?: string
  readonly expiresAt?: number
  readonly redirectUrl?: string
  /**
   * Set when IAM answered the login with a multi-factor signal instead of a
   * session/code. `mfaStage` discriminates the two IAM states:
   *   - `'enroll'`  — IAM returned `data:"RequiredMfa"`: org policy forces MFA
   *     and the user has none yet → render forced TOTP enrollment.
   *   - `'challenge'` — IAM returned `data:"NextMfa"`: the user has MFA enabled
   *     → render a code challenge for one of `mfaTypes`.
   * The password session is NOT established until the enrollment/challenge
   * completes, so the portal must not navigate past this signal.
   */
  readonly mfaRequired?: boolean
  readonly mfaStage?: 'enroll' | 'challenge'
  /**
   * The IAM MFA types available for a `'challenge'` (from the login response's
   * `data2`), in IAM's own vocabulary: `app` (TOTP), `sms`, `email`. Empty for
   * enrollment.
   */
  readonly mfaTypes?: readonly string[]
  readonly error?: string
}

/**
 * Result of approving an RFC 8628 device-authorization request
 * ({@link AuthClient.approveDevice}).
 *
 * `ok` — the device code was marked signed-in (the CLI's token poll now
 * succeeds). `required` — the application needs the user to grant consent
 * before approval can complete (`{status:ok, data:{required:true}}`); rare for
 * first-party apps. `error` — the IAM-surfaced failure message (e.g.
 * "UserCode Expired", "DeviceCode Invalid").
 */
export interface DeviceApprovalResult {
  readonly ok: boolean
  readonly required?: boolean
  readonly error?: string
}

/**
 * The TOTP enrollment material minted by `/v1/iam/mfa/setup/initiate`. The
 * secret + `url` (an `otpauth://` URI) are rendered locally as a QR code — the
 * secret never leaves the browser to a third party. `recoveryCodes[0]` must be
 * echoed back to `/v1/iam/mfa/setup/enable`.
 */
export interface MfaSetup {
  /** IAM MFA type — `app` for TOTP. */
  readonly mfaType: string
  /** Base32 TOTP secret. */
  readonly secret: string
  /** `otpauth://totp/...` provisioning URI for the authenticator app. */
  readonly url: string
  /** One-time recovery codes issued alongside the secret. */
  readonly recoveryCodes: readonly string[]
}

/** The signed-in user's identity, resolved from the IAM session for MFA setup. */
export interface MfaIdentity {
  readonly owner: string
  readonly name: string
}

/** A TOTP challenge submission for a user who already enrolled (`NextMfa`). */
export interface MfaChallengeRequest {
  /** IAM MFA type, e.g. `app` (TOTP), `sms`, `email`. */
  readonly mfaType: string
  readonly passcode: string
  readonly clientId: string
  readonly application: string
  readonly organization: string
  readonly redirectUri?: string
  readonly state?: string
  readonly codeChallenge?: string
  readonly codeChallengeMethod?: 'S256' | 'plain'
  /** Honor the org's "remember this device" window after a successful code. */
  readonly rememberDevice?: boolean
}

export interface SignupRequest {
  readonly email: string
  readonly password: string
  readonly clientId: string
  readonly application: string
  readonly organization: string
  readonly inviteCode?: string
}

export interface ForgotRequest {
  readonly identifier: string
  readonly clientId: string
  readonly organization: string
}

export interface OAuthAuthorizeRequest {
  readonly clientId: string
  readonly redirectUri: string
  readonly state: string
  readonly scope?: string
  readonly nonce?: string
  readonly responseType?: 'code' | 'token'
  readonly codeChallenge?: string
  readonly codeChallengeMethod?: 'S256' | 'plain'
  /** Social provider name (e.g. "provider-github"); IAM initiates that provider's OAuth. */
  readonly provider?: string
}

/** A third-party / wallet login provider attached to the application. */
export interface ProviderInfo {
  readonly name: string
  readonly displayName?: string
  /** IAM provider type, e.g. GitHub, Google, Apple, Web3Onboard. */
  readonly type?: string
  /** IAM category, e.g. OAuth, Web3, SAML. */
  readonly category?: string
  readonly canSignIn?: boolean
  readonly canSignUp?: boolean
}

/** A sign-in method offered by the application (Password, Verification code, WebAuthn, …). */
export interface SigninMethod {
  readonly name: string
  readonly rule?: string
}

/** The subset of the application's login config the portal renders from. */
export interface AppLoginInfo {
  readonly name: string
  readonly displayName?: string
  readonly providers: ProviderInfo[]
  readonly signinMethods: SigninMethod[]
  readonly enablePassword: boolean
  readonly enableCodeSignin: boolean
  readonly enableSignUp: boolean
}

/** Passwordless login with an email/SMS verification code. */
export interface CodeLoginRequest {
  /** Destination already sent a code: an email address or E.164 phone number. */
  readonly dest: string
  readonly code: string
  readonly clientId: string
  readonly application: string
  readonly organization: string
  readonly redirectUri?: string
  readonly state?: string
}

export interface TokenResponse {
  readonly accessToken: string
  readonly refreshToken?: string
  readonly idToken?: string
  readonly tokenType: string
  readonly expiresIn?: number
  readonly scope?: string
}

/** A social/web3 provider enabled on an IAM application. */
export interface AppProvider {
  /** IAM provider record name, e.g. `provider-github`. */
  readonly name: string
  /** Normalized provider key passed to the authorize endpoint, e.g. `github`, `google`, `web3`. */
  readonly key: string
  /** Whether the provider may be used to sign in. */
  readonly canSignIn: boolean
  /** Whether the provider may be used to sign up. */
  readonly canSignUp: boolean
  /**
   * Whether IAM holds a real OAuth credential for this provider (a non-empty,
   * non-placeholder clientId). The login UI renders ONLY configured providers,
   * so an unprovisioned button never dead-ends the user — it appears
   * automatically once real credentials are seeded into IAM. The seed ships
   * obvious placeholders (`GITHUB_CLIENT_ID_PLACEHOLDER`, `placeholder`), which
   * read as not-configured.
   */
  readonly configured: boolean
  /** IAM provider `type`, e.g. `GitHub` / `Google` / `Web3Onboard` (selects the OAuth endpoint). */
  readonly type: string
  /** The provider's OAuth client id (used to build the provider redirect; empty when unconfigured). */
  readonly clientId: string
  /** Override OAuth scopes, if the provider record sets them. */
  readonly scopes: string
}

/**
 * The enabled-auth-methods view of an IAM application, read live from
 * `/v1/iam/get-app-login`. This is the canonical source of truth for which
 * buttons to render — it reflects the per-app config in `init_data.json`
 * (password + GitHub + Google + Web3). The portal renders exactly what IAM
 * reports enabled, so there is no client/server method drift.
 */
export interface AppLogin {
  /** IAM application name (e.g. `hanzo-id`). */
  readonly application: string
  /** Owning organization slug. */
  readonly organization: string
  /** Email/username + password sign-in is enabled. */
  readonly enablePassword: boolean
  /** Self-service signup is enabled. */
  readonly enableSignUp: boolean
  /** Email/SMS verification-code sign-in is enabled. */
  readonly enableCodeSignin: boolean
  /** Social + Web3 providers enabled on the app, in display order. */
  readonly providers: readonly AppProvider[]
}
