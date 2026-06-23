import type { TenantConfig } from '@hanzo/id-shared'
import type {
  AppLoginInfo,
  CodeLoginRequest,
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
 * paths under `/v1/iam/*` and the OIDC paths under `/v1/iam/oauth/*`). One
 * client instance per tenant. The portal creates one in `createRoot()`;
 * downstream pages call `.login()`, `.signup()`, `.forgot()`, `.authorize()`
 * directly.
 *
 * Wire contract (verified against live IAM): the auth fields — `type`,
 * `application`, `organization` — are read from the request BODY; the OAuth
 * params — `clientId`, `responseType`, `redirectUri`, `scope`, `state` — ride
 * on the query string. `type=code` (a client `redirectUri` is present) returns
 * an authorization code in `data`; `type=login` (bare portal sign-in)
 * establishes the session cookie.
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
  /** Fetch the application's enabled providers + sign-in methods (drives which buttons render). */
  appLogin(): Promise<AppLoginInfo>
  /** Send an email/SMS verification code for passwordless login. dest = email or E.164 phone. */
  sendLoginCode(dest: string): Promise<{ ok: boolean; error?: string }>
  /** Complete a passwordless login with the code sent to dest. */
  loginWithCode(req: CodeLoginRequest): Promise<LoginResponse>
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
    const type = req.redirectUri ? 'code' : 'login'
    const url = new URL('/v1/iam/login', tenant.iamUrl)
    url.searchParams.set('clientId', req.clientId)
    url.searchParams.set('responseType', 'code')
    if (req.redirectUri) url.searchParams.set('redirectUri', req.redirectUri)
    url.searchParams.set('scope', req.scope ?? 'openid profile email')
    if (req.state) url.searchParams.set('state', req.state)
    // PKCE passthrough: when this login completes a downstream app's OAuth
    // authorize (console, chat, …), bind the app's challenge to the minted code
    // so IAM enforces it at /oauth/token against the app's verifier.
    if (req.codeChallenge) {
      url.searchParams.set('code_challenge', req.codeChallenge)
      url.searchParams.set('code_challenge_method', req.codeChallengeMethod ?? 'S256')
    }
    url.searchParams.set('type', type)
    const res = await f(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        type,
        username: req.identifier,
        password: req.password,
        application: req.application,
        organization: req.organization,
        signinMethod: 'Password',
        autoSignin: true,
      }),
    })
    return parseLoginResponse(res, req)
  }

  async function signup(req: SignupRequest): Promise<LoginResponse> {
    const url = new URL('/v1/iam/signup', tenant.iamUrl)
    url.searchParams.set('clientId', req.clientId)
    const username = req.email.split('@')[0]
    const res = await f(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        application: req.application,
        organization: req.organization,
        username,
        name: username,
        email: req.email,
        password: req.password,
        confirm: req.password,
        autoSignin: true,
        ...(req.inviteCode ? { invitationCode: req.inviteCode } : {}),
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
      body: JSON.stringify({
        applicationId: `admin/${tenant.appName}`,
        organization: req.organization,
        dest: req.identifier,
        type: req.identifier.includes('@') ? 'email' : 'phone',
        method: 'forget',
        checkUser: req.identifier,
      }),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (body.status === 'error') return { ok: false, error: typeof body.msg === 'string' ? body.msg : 'failed' }
    return { ok: true }
  }

  function authorize(req: OAuthAuthorizeRequest): string {
    const url = new URL('/v1/iam/oauth/authorize', tenant.iamUrl)
    url.searchParams.set('client_id', req.clientId)
    url.searchParams.set('redirect_uri', req.redirectUri)
    url.searchParams.set('response_type', req.responseType ?? 'code')
    url.searchParams.set('scope', req.scope ?? 'openid profile email')
    url.searchParams.set('state', req.state)
    if (req.provider) url.searchParams.set('provider', req.provider)
    if (req.nonce) url.searchParams.set('nonce', req.nonce)
    if (req.codeChallenge) {
      url.searchParams.set('code_challenge', req.codeChallenge)
      url.searchParams.set('code_challenge_method', req.codeChallengeMethod ?? 'S256')
    }
    return url.toString()
  }

  async function exchange(code: string, codeVerifier?: string): Promise<TokenResponse> {
    const url = new URL('/v1/iam/oauth/token', tenant.iamUrl)
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
    const url = new URL('/v1/iam/oauth/logout', tenant.iamUrl)
    if (idTokenHint) url.searchParams.set('id_token_hint', idTokenHint)
    url.searchParams.set(
      'post_logout_redirect_uri',
      postLogoutRedirectUri ?? `${tenant.publicOrigin}/login`,
    )
    return url.toString()
  }

  // appLogin fetches the application's enabled providers + sign-in methods so
  // the UI renders exactly what the IAM app offers (social buttons, code login).
  async function appLogin(): Promise<AppLoginInfo> {
    const url = new URL('/v1/iam/get-app-login', tenant.iamUrl)
    url.searchParams.set('clientId', tenant.clientId)
    url.searchParams.set('responseType', 'code')
    url.searchParams.set('redirectUri', `${tenant.publicOrigin}/callback`)
    url.searchParams.set('scope', 'openid profile email')
    url.searchParams.set('state', 'login')
    const res = await f(url.toString(), { credentials: 'include' })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    const d = (body.data ?? {}) as Record<string, unknown>
    const providers = Array.isArray(d.providers)
      ? (d.providers as Array<Record<string, unknown>>).map((p) => {
          const prov = (p.provider ?? {}) as Record<string, unknown>
          return {
            name: String(p.name ?? prov.name ?? ''),
            displayName: typeof prov.displayName === 'string' ? prov.displayName : undefined,
            type: typeof prov.type === 'string' ? prov.type : undefined,
            category: typeof prov.category === 'string' ? prov.category : undefined,
            canSignIn: p.canSignIn !== false,
            canSignUp: p.canSignUp !== false,
          }
        })
      : []
    const signinMethods = Array.isArray(d.signinMethods)
      ? (d.signinMethods as Array<Record<string, unknown>>).map((m) => ({
          name: String(m.name ?? ''),
          rule: typeof m.rule === 'string' ? m.rule : undefined,
        }))
      : []
    return {
      name: String(d.name ?? tenant.appName),
      displayName: typeof d.displayName === 'string' ? d.displayName : undefined,
      providers,
      signinMethods,
      enablePassword: d.enablePassword !== false,
      enableCodeSignin: d.enableCodeSignin === true,
      enableSignUp: d.enableSignUp !== false,
    }
  }

  async function sendLoginCode(dest: string): Promise<{ ok: boolean; error?: string }> {
    const url = new URL('/v1/iam/send-verification-code', tenant.iamUrl)
    url.searchParams.set('clientId', tenant.clientId)
    url.searchParams.set('organization', tenant.orgId)
    const isEmail = dest.includes('@')
    const res = await f(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        applicationId: `admin/${tenant.appName}`,
        organization: tenant.orgId,
        dest,
        type: isEmail ? 'email' : 'phone',
        method: 'login',
        checkUser: dest,
      }),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (body.status === 'error') return { ok: false, error: typeof body.msg === 'string' ? body.msg : 'failed' }
    return { ok: true }
  }

  async function loginWithCode(req: CodeLoginRequest): Promise<LoginResponse> {
    const type = req.redirectUri ? 'code' : 'login'
    const url = new URL('/v1/iam/login', tenant.iamUrl)
    url.searchParams.set('clientId', req.clientId)
    url.searchParams.set('responseType', 'code')
    if (req.redirectUri) url.searchParams.set('redirectUri', req.redirectUri)
    url.searchParams.set('scope', req.scope ?? 'openid profile email')
    if (req.state) url.searchParams.set('state', req.state)
    if (req.codeChallenge) {
      url.searchParams.set('code_challenge', req.codeChallenge)
      url.searchParams.set('code_challenge_method', req.codeChallengeMethod ?? 'S256')
    }
    url.searchParams.set('type', type)
    const isEmail = req.dest.includes('@')
    const res = await f(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        type,
        username: req.dest,
        code: req.code,
        application: req.application,
        organization: req.organization,
        signinMethod: 'Verification code',
        ...(isEmail ? { email: req.dest } : { phone: req.dest }),
        autoSignin: true,
      }),
    })
    return parseLoginResponse(res, req)
  }

  return {
    tenant,
    login,
    signup,
    forgot,
    authorize,
    exchange,
    logout,
    appLogin,
    sendLoginCode,
    loginWithCode,
  }
}

async function parseLoginResponse(
  res: Response,
  req?: { redirectUri?: string; state?: string },
): Promise<LoginResponse> {
  let body: Record<string, unknown> = {}
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    return { error: `HTTP ${res.status} non-JSON response` }
  }
  if (!res.ok || body.status === 'error') {
    return { error: typeof body.msg === 'string' ? body.msg : `HTTP ${res.status}` }
  }
  const data = body.data

  // Authorization-code flow: a client redirectUri is present and `data` is the
  // freshly minted code — hand the SPA a fully-formed redirect back to the app.
  if (req?.redirectUri && typeof data === 'string' && data.length > 0) {
    const sep = req.redirectUri.includes('?') ? '&' : '?'
    return {
      redirectUrl: `${req.redirectUri}${sep}code=${encodeURIComponent(data)}&state=${encodeURIComponent(req.state ?? '')}`,
    }
  }

  // Bare portal sign-in: the IAM session cookie is now set; land on the portal.
  // The `signed_in` marker tells the portal the session was just established
  // this tab — it shows the apps launcher even if the cross-proxy
  // `get-account` session lookup hasn't propagated yet.
  if (!req?.redirectUri) {
    return { redirectUrl: '/?signed_in=1' }
  }

  // Fallback: a nested token payload (future direct-token IAM responses).
  const d = (typeof data === 'object' && data ? data : body) as Record<string, unknown>
  return {
    accessToken: typeof d.access_token === 'string' ? d.access_token : undefined,
    refreshToken: typeof d.refresh_token === 'string' ? d.refresh_token : undefined,
    idToken: typeof d.id_token === 'string' ? d.id_token : undefined,
    expiresAt: typeof d.expires_at === 'number' ? d.expires_at : undefined,
    mfaRequired: d.mfa_required === true,
    mfaChannel: typeof d.mfa_channel === 'string' ? (d.mfa_channel as LoginResponse['mfaChannel']) : undefined,
  }
}
