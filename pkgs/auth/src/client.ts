import type { TenantConfig } from '@hanzo/id-shared'
import type {
  AppLogin,
  AppProvider,
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
  /**
   * Read the live enabled-auth-methods view for an application from
   * `/v1/iam/get-app-login` — the canonical source of truth for which
   * sign-in buttons (password / GitHub / Google / Web3) to render.
   * Resolves to null when the endpoint is unreachable so callers can fall
   * back to the tenant's declared default method set.
   */
  getAppLogin(clientId?: string): Promise<AppLogin | null>
  /**
   * Complete a social provider login when the provider redirects back to
   * `/callback` with a `code` + base64 `state` (see `social.ts`). Exchanges the
   * provider code at the IAM backend (the Casdoor `AuthBackend.login` contract)
   * and resolves the URL to redirect to — the original OIDC `redirect_uri` with
   * an authorization code, which the portal's normal PKCE callback then
   * completes. NOTE: pending live verification — runs only once real OAuth
   * provider creds are seeded (the buttons are hidden until then).
   */
  providerLogin(req: ProviderExchangeRequest): Promise<{ redirectUrl?: string; error?: string }>
}

/** Inputs to {@link AuthClient.providerLogin}, recovered from the /callback return. */
export interface ProviderExchangeRequest {
  /** IAM application name (from the decoded state). */
  readonly application: string
  /** IAM provider record name, e.g. `provider-github`. */
  readonly provider: string
  /** The provider's authorization code (the `?code=` on the /callback return). */
  readonly code: string
  /** The ORIGINAL OIDC authorize query string (decoded from the base64 state). */
  readonly oidcQuery: string
  /** "signin" | "signup". */
  readonly method: string
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
    url.searchParams.set('scope', 'openid profile email')
    if (req.state) url.searchParams.set('state', req.state)
    // Echo the downstream OIDC nonce so the minted code -> id_token carries it.
    // Strict openid-client consumers (LibreChat OPENID_REUSE_TOKENS) reject an
    // id_token whose nonce != the one they sent ("unexpected JWT claim value").
    if (req.nonce) url.searchParams.set('nonce', req.nonce)
    if (req.codeChallenge) {
      url.searchParams.set('code_challenge', req.codeChallenge)
      url.searchParams.set('code_challenge_method', req.codeChallengeMethod ?? 'S256')
    }
    url.searchParams.set('type', type)
    // `organization` is an OPTIONAL lookup hint (see LoginRequest). Omit it when
    // empty so IAM runs its cross-org resolution: a global-admin identity then
    // resolves to the `admin` org (full multi-org session) instead of being
    // pinned to — and truncated by — a colliding brand-org row. The session's
    // org is always the resolved user's real owner, never this hint.
    const body: Record<string, unknown> = {
      type,
      username: req.identifier,
      password: req.password,
      application: req.application,
      signinMethod: 'Password',
      autoSignin: true,
    }
    if (req.organization) body.organization = req.organization
    const res = await f(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
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

  async function getAppLogin(clientId?: string): Promise<AppLogin | null> {
    const id = clientId ?? tenant.clientId
    const url = new URL('/v1/iam/get-app-login', tenant.iamUrl)
    url.searchParams.set('clientId', id)
    url.searchParams.set('responseType', 'code')
    url.searchParams.set('redirectUri', `${tenant.publicOrigin}/callback`)
    url.searchParams.set('scope', 'openid profile email')
    url.searchParams.set('state', 'app-login')
    let body: Record<string, unknown>
    try {
      const res = await f(url.toString(), { headers: { Accept: 'application/json' } })
      if (!res.ok) return null
      body = (await res.json()) as Record<string, unknown>
    } catch {
      return null
    }
    if (body.status !== 'ok' || typeof body.data !== 'object' || body.data === null) return null
    return parseAppLogin(body.data as Record<string, unknown>, tenant.appName, tenant.orgId)
  }

  async function providerLogin(
    req: ProviderExchangeRequest,
  ): Promise<{ redirectUrl?: string; error?: string }> {
    // POST the provider code to the IAM backend with the original OIDC params
    // as the query string (Casdoor `AuthBackend.login(body, oAuthParams)`). The
    // backend exchanges the code, signs the user in, and returns the URL to
    // continue the original authorize request.
    const url = new URL('/v1/iam/login', tenant.iamUrl)
    const oidc = new URLSearchParams(req.oidcQuery.replace(/^\?/, ''))
    for (const [k, v] of oidc) {
      if (['client_id', 'redirect_uri', 'response_type', 'scope', 'state', 'nonce', 'code_challenge', 'code_challenge_method'].includes(k)) {
        url.searchParams.set(k, v)
      }
    }
    const res = await f(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        type: 'code',
        application: req.application,
        provider: req.provider,
        code: req.code,
        state: req.application,
        redirectUri: `${tenant.publicOrigin}/callback`,
        method: req.method,
      }),
    })
    let body: Record<string, unknown> = {}
    try {
      body = (await res.json()) as Record<string, unknown>
    } catch {
      return { error: `HTTP ${res.status} non-JSON response` }
    }
    if (!res.ok || body.status === 'error') {
      return { error: typeof body.msg === 'string' ? body.msg : `HTTP ${res.status}` }
    }
    // On success the backend returns the continue-URL in `data`.
    const data = typeof body.data === 'string' ? body.data : ''
    return data ? { redirectUrl: data } : { error: 'provider login returned no redirect' }
  }

  return { tenant, login, signup, forgot, authorize, exchange, logout, getAppLogin, providerLogin }
}

/**
 * Map an IAM provider record to its canonical authorize-endpoint `provider`
 * key. IAM names providers `provider-<key>` (e.g. `provider-github`); the
 * `/v1/iam/oauth/authorize?provider=<key>` param wants the bare key. The
 * Web3Onboard wallet provider maps to `web3`.
 */
function providerKey(name: string): string {
  return name.replace(/^provider-/, '')
}

/**
 * A provider is renderable only when IAM holds a real OAuth clientId for it.
 * The seed ships obvious placeholders (`GITHUB_CLIENT_ID_PLACEHOLDER`,
 * `placeholder`); an empty or placeholder id means the provider isn't
 * provisioned, so its button is hidden rather than dead-ending the user. Real
 * OAuth client ids never contain "placeholder".
 */
function isConfiguredClientId(clientId: string): boolean {
  return clientId.length > 0 && !/placeholder/i.test(clientId)
}

/** Shape the `/v1/iam/get-app-login` `data` payload into the {@link AppLogin} view. */
function parseAppLogin(
  data: Record<string, unknown>,
  fallbackApp: string,
  fallbackOrg: string,
): AppLogin {
  const rawProviders = Array.isArray(data.providers) ? data.providers : []
  const providers: AppProvider[] = rawProviders
    .map((p): AppProvider | null => {
      if (typeof p !== 'object' || p === null) return null
      const rec = p as Record<string, unknown>
      const name = typeof rec.name === 'string' ? rec.name : ''
      if (!name) return null
      // The clientId lives on the nested provider record (`rec.provider`), not
      // the outer link object.
      const inner =
        typeof rec.provider === 'object' && rec.provider !== null
          ? (rec.provider as Record<string, unknown>)
          : {}
      const clientId = typeof inner.clientId === 'string' ? inner.clientId : ''
      return {
        name,
        key: providerKey(name),
        canSignIn: rec.canSignIn !== false,
        canSignUp: rec.canSignUp !== false,
        configured: isConfiguredClientId(clientId),
        type: typeof inner.type === 'string' ? inner.type : '',
        clientId,
        scopes: typeof inner.scopes === 'string' ? inner.scopes : '',
      }
    })
    .filter((p): p is AppProvider => p !== null)
  return {
    application: typeof data.name === 'string' ? data.name : fallbackApp,
    organization: typeof data.organization === 'string' ? data.organization : fallbackOrg,
    enablePassword: data.enablePassword !== false,
    enableSignUp: data.enableSignUp !== false,
    enableCodeSignin: data.enableCodeSignin === true,
    providers,
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

  // Bare portal sign-in: the IAM session cookie is now set; land on the
  // post-login onboarding flow. Onboarding's IAM writes ride the same
  // session cookie (`credentials: include`), so no bearer token is needed
  // for the password path.
  if (!req?.redirectUri) {
    return { redirectUrl: '/onboarding' }
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
