import type { TenantConfig } from '@hanzo/id-shared'
import type {
  ForgotRequest,
  LoginRequest,
  LoginResponse,
  OAuthAuthorizeRequest,
  SignupRequest,
  TokenResponse,
} from './types'

/**
 * Composable IAM client.
 *
 * Stateless wrapper around the canonical IAM REST surface (Casdoor-compat
 * paths under `/v1/iam/*` and the OIDC paths under `/oauth/*`). One client
 * instance per tenant. The portal creates one in `createRoot()`; downstream
 * pages call `.login()`, `.signup()`, `.forgot()`, `.authorize()` directly.
 *
 * Token storage is intentionally NOT part of this client — the portal is a
 * white-label OIDC provider, so tokens are minted then immediately redirected
 * back to the requesting app via `redirectUri`. The browser never holds them
 * past the redirect.
 */
export interface AuthClient {
  readonly tenant: TenantConfig
  login(req: LoginRequest): Promise<LoginResponse>
  signup(req: SignupRequest): Promise<LoginResponse>
  forgot(req: ForgotRequest): Promise<{ ok: boolean; error?: string }>
  authorize(req: OAuthAuthorizeRequest): string
  exchange(code: string, codeVerifier?: string): Promise<TokenResponse>
  logout(idTokenHint?: string, postLogoutRedirectUri?: string): string
}

export interface AuthClientOptions {
  readonly tenant: TenantConfig
  /** Override fetch impl (testing). Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch
}

export function createAuthClient(opts: AuthClientOptions): AuthClient {
  const tenant = opts.tenant
  const f = opts.fetchImpl ?? fetch

  async function login(req: LoginRequest): Promise<LoginResponse> {
    const url = new URL('/v1/iam/login', tenant.iamUrl)
    url.searchParams.set('clientId', req.clientId)
    url.searchParams.set('application', req.application)
    url.searchParams.set('organization', req.organization)
    if (req.redirectUri) url.searchParams.set('redirect_uri', req.redirectUri)
    if (req.state) url.searchParams.set('state', req.state)
    const res = await f(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        username: req.identifier,
        password: req.password,
        signinMethod: 'Password',
        language: 'en',
        autoSignin: true,
      }),
    })
    return parseLoginResponse(res)
  }

  async function signup(req: SignupRequest): Promise<LoginResponse> {
    const url = new URL('/v1/iam/signup', tenant.iamUrl)
    url.searchParams.set('clientId', req.clientId)
    url.searchParams.set('application', req.application)
    url.searchParams.set('organization', req.organization)
    const res = await f(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        email: req.email,
        password: req.password,
        inviteCode: req.inviteCode,
      }),
    })
    return parseLoginResponse(res)
  }

  async function forgot(req: ForgotRequest): Promise<{ ok: boolean; error?: string }> {
    const url = new URL('/v1/iam/send-verification-code', tenant.iamUrl)
    url.searchParams.set('clientId', req.clientId)
    url.searchParams.set('organization', req.organization)
    const res = await f(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dest: req.identifier, type: 'login' }),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true }
  }

  function authorize(req: OAuthAuthorizeRequest): string {
    const url = new URL('/oauth/authorize', tenant.iamUrl)
    url.searchParams.set('client_id', req.clientId)
    url.searchParams.set('redirect_uri', req.redirectUri)
    url.searchParams.set('response_type', req.responseType ?? 'code')
    url.searchParams.set('scope', req.scope ?? 'openid profile email')
    url.searchParams.set('state', req.state)
    if (req.nonce) url.searchParams.set('nonce', req.nonce)
    if (req.codeChallenge) {
      url.searchParams.set('code_challenge', req.codeChallenge)
      url.searchParams.set('code_challenge_method', req.codeChallengeMethod ?? 'S256')
    }
    return url.toString()
  }

  async function exchange(code: string, codeVerifier?: string): Promise<TokenResponse> {
    const url = new URL('/oauth/token', tenant.iamUrl)
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: tenant.clientId,
      redirect_uri: `${tenant.publicOrigin}/callback`,
    })
    if (codeVerifier) body.set('code_verifier', codeVerifier)
    const res = await f(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) throw new Error(`token exchange failed: ${res.status}`)
    const data = (await res.json()) as Record<string, unknown>
    return {
      accessToken: String(data.access_token ?? ''),
      refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
      idToken: typeof data.id_token === 'string' ? data.id_token : undefined,
      tokenType: String(data.token_type ?? 'Bearer'),
      expiresIn: typeof data.expires_in === 'number' ? data.expires_in : undefined,
      scope: typeof data.scope === 'string' ? data.scope : undefined,
    }
  }

  function logout(idTokenHint?: string, postLogoutRedirectUri?: string): string {
    const url = new URL('/oauth/logout', tenant.iamUrl)
    if (idTokenHint) url.searchParams.set('id_token_hint', idTokenHint)
    url.searchParams.set(
      'post_logout_redirect_uri',
      postLogoutRedirectUri ?? `${tenant.publicOrigin}/login`,
    )
    return url.toString()
  }

  return { tenant, login, signup, forgot, authorize, exchange, logout }
}

async function parseLoginResponse(res: Response): Promise<LoginResponse> {
  let body: Record<string, unknown> = {}
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    return { error: `HTTP ${res.status} non-JSON response` }
  }
  if (!res.ok || body.status === 'error') {
    return { error: typeof body.msg === 'string' ? body.msg : `HTTP ${res.status}` }
  }
  const data = (body.data ?? body) as Record<string, unknown>
  return {
    accessToken: typeof data.access_token === 'string' ? data.access_token : undefined,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    idToken: typeof data.id_token === 'string' ? data.id_token : undefined,
    expiresAt: typeof data.expires_at === 'number' ? data.expires_at : undefined,
    redirectUrl: typeof data.redirect_url === 'string' ? data.redirect_url : undefined,
    mfaRequired: data.mfa_required === true,
    mfaChannel: typeof data.mfa_channel === 'string' ? (data.mfa_channel as LoginResponse['mfaChannel']) : undefined,
  }
}
