export interface LoginRequest {
  readonly identifier: string
  readonly password: string
  readonly clientId: string
  readonly application: string
  readonly organization: string
  readonly redirectUri?: string
  readonly state?: string
  readonly codeChallenge?: string
  readonly codeChallengeMethod?: 'S256' | 'plain'
}

export interface LoginResponse {
  readonly accessToken?: string
  readonly refreshToken?: string
  readonly idToken?: string
  readonly expiresAt?: number
  readonly redirectUrl?: string
  readonly mfaRequired?: boolean
  readonly mfaChannel?: 'totp' | 'sms' | 'email'
  readonly error?: string
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
