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
}

export interface TokenResponse {
  readonly accessToken: string
  readonly refreshToken?: string
  readonly idToken?: string
  readonly tokenType: string
  readonly expiresIn?: number
  readonly scope?: string
}
