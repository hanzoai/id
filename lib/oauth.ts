/**
 * OAuth2 / OIDC client with PKCE (RFC 7636)
 *
 * Works against Hanzo IAM backend via the tenant's iamOrigin.
 */

// --- PKCE helpers ---

function generateRandomString(length: number): string {
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, length)
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder()
  return crypto.subtle.digest('SHA-256', encoder.encode(plain))
}

function base64urlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function generatePKCE() {
  const verifier = generateRandomString(64)
  const hashed = await sha256(verifier)
  const challenge = base64urlEncode(hashed)
  return { verifier, challenge }
}

// --- Types ---

export interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  id_token?: string
  scope?: string
}

export interface UserInfo {
  sub: string
  name?: string
  displayName?: string
  preferred_username?: string
  email?: string
  avatar?: string
  permanentAvatar?: string
  picture?: string
  owner?: string
}

// --- Token storage (sessionStorage for PKCE, localStorage for session) ---

const PREFIX = 'hanzo_auth_'

export function storeSession(key: string, value: string) {
  sessionStorage.setItem(PREFIX + key, value)
}

export function retrieveSession(key: string): string | null {
  const val = sessionStorage.getItem(PREFIX + key)
  sessionStorage.removeItem(PREFIX + key)
  return val
}

// --- Core flows ---

/**
 * Password login against IAM /api/login.
 * Returns JWT token directly.
 */
export async function passwordLogin(params: {
  iamUrl: string
  org: string
  username: string
  password: string
  application: string
  clientId?: string
  redirectUri?: string
}): Promise<{ token: string; code?: string }> {
  const url = new URL('/api/login', params.iamUrl)

  // If OAuth params provided, pass as query params (camelCase — IAM convention)
  if (params.clientId && params.redirectUri) {
    url.searchParams.set('clientId', params.clientId)
    url.searchParams.set('responseType', 'code')
    url.searchParams.set('redirectUri', params.redirectUri)
    url.searchParams.set('scope', 'openid profile email')
  }

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'token',
      organization: params.org,
      username: params.username,
      password: params.password,
      application: params.application,
      ...(params.clientId ? { clientId: params.clientId } : {}),
      ...(params.redirectUri ? { redirectUri: params.redirectUri } : {}),
    }),
  })

  const data = await res.json()

  if (data.status !== 'ok') {
    throw new Error(data.msg || 'Login failed')
  }

  return { token: data.data }
}

/**
 * Start OAuth authorize redirect with PKCE.
 */
export async function startAuthorize(params: {
  iamUrl: string
  clientId: string
  redirectUri: string
  scope?: string
}) {
  const { verifier, challenge } = await generatePKCE()
  const state = generateRandomString(32)

  storeSession('pkce_verifier', verifier)
  storeSession('oauth_state', state)

  const url = new URL('/oauth/authorize', params.iamUrl)
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('scope', params.scope ?? 'openid profile email')
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')

  window.location.href = url.toString()
}

/**
 * Exchange authorization code for tokens.
 */
export async function exchangeCode(params: {
  iamUrl: string
  code: string
  state: string
  clientId: string
  redirectUri: string
}): Promise<TokenResponse> {
  const savedState = retrieveSession('oauth_state')
  if (savedState !== params.state) {
    throw new Error('OAuth state mismatch')
  }

  const verifier = retrieveSession('pkce_verifier')

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    ...(verifier ? { code_verifier: verifier } : {}),
  })

  const res = await fetch(`${params.iamUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status}`)
  }

  return res.json()
}

/**
 * Fetch user info.
 */
export async function fetchUserInfo(iamUrl: string, accessToken: string): Promise<UserInfo> {
  const res = await fetch(`${iamUrl}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Userinfo failed: ${res.status}`)
  return res.json()
}
