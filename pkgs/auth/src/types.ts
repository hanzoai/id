export interface LoginRequest {
  readonly identifier: string
  readonly password: string
  readonly clientId: string
  readonly application: string
  readonly organization: string
  readonly redirectUri?: string
  readonly state?: string
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
  /** Social provider name (e.g. "provider-github"); IAM initiates that provider's OAuth. */
  readonly provider?: string
}

/** A third-party / wallet login provider attached to the application. */
export interface ProviderInfo {
  readonly name: string
  readonly displayName?: string
  /** Casdoor provider type, e.g. GitHub, Google, Apple, Web3Onboard. */
  readonly type?: string
  /** Casdoor category, e.g. OAuth, Web3, SAML. */
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
