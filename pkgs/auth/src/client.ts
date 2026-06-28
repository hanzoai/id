import type { TenantConfig } from '@hanzo/id-shared'
import type {
  AppLogin,
  AppProvider,
  DeviceApprovalResult,
  ForgotRequest,
  LoginRequest,
  LoginResponse,
  OAuthAuthorizeRequest,
  SignupRequest,
  SilentLoginRequest,
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
  /**
   * Silent single-sign-on: mint an authorization code from the EXISTING issuer
   * session (the `iam_session_id` cookie set when the user signed in once for
   * another app) — no credentials, no provider hop. Returns `{ redirectUrl }`
   * (the app's `redirect_uri` + `?code=&state=`) when a live session exists, or
   * `{ error }` when it does not so the caller renders the interactive form.
   * This is the seamless 2nd/3rd-app login leg.
   */
  silentLogin(req: SilentLoginRequest): Promise<LoginResponse>
  /**
   * Approve an RFC 8628 device-authorization request from the device-approval
   * page (`/login/oauth/device`). The user MUST already be signed in to the
   * issuer — this rides the SAME `iam_session_id` cookie as silent SSO
   * (`credentials:'include'`, no credentials in the body). It POSTs
   * `/v1/iam/login` with `type:'device'` + the `userCode` the device shows,
   * plus the tenant's `application`/`organization`; IAM resolves the user from
   * the session, flips the device code's `UserSignIn=true`, and the CLI's token
   * poll then succeeds. Returns `{required:true}` when the app needs consent
   * first (rare for first-party apps), or `{error}` with the IAM message.
   */
  approveDevice(userCode: string): Promise<DeviceApprovalResult>
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

  async function silentLogin(req: SilentLoginRequest): Promise<LoginResponse> {
    const url = new URL('/v1/iam/login', tenant.iamUrl)
    url.searchParams.set('clientId', req.clientId)
    url.searchParams.set('responseType', 'code')
    url.searchParams.set('redirectUri', req.redirectUri)
    url.searchParams.set('scope', req.scope ?? 'openid profile email')
    if (req.state) url.searchParams.set('state', req.state)
    if (req.nonce) url.searchParams.set('nonce', req.nonce)
    if (req.codeChallenge) {
      url.searchParams.set('code_challenge', req.codeChallenge)
      url.searchParams.set('code_challenge_method', req.codeChallengeMethod ?? 'S256')
    }
    url.searchParams.set('type', 'code')
    // NO username/password and NO provider: IAM's Login handler falls through to
    // its "already signed in to IAM" branch (`GetSessionUsername() != ""`) and
    // mints an authorization code for `application` from the existing
    // `iam_session_id` cookie. `credentials: 'include'` sends that cookie. When
    // there is no live session IAM responds `status:error` -> parseLoginResponse
    // returns `{ error }`, and Login.tsx renders the interactive form instead.
    const res = await f(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ type: 'code', application: req.application, autoSignin: true }),
    })
    return parseLoginResponse(res, { redirectUri: req.redirectUri, state: req.state })
  }

  async function approveDevice(userCode: string): Promise<DeviceApprovalResult> {
    const code = normalizeUserCode(userCode)
    if (!code) return { ok: false, error: 'Enter the code shown on your device.' }
    const url = new URL('/v1/iam/login', tenant.iamUrl)
    // IAM's device branch keys the cache off the `userCode` in the BODY; the
    // `type` echo on the query mirrors the other login legs. NO credentials —
    // the user is already signed in, so this rides the session cookie
    // (`credentials:'include'`) and IAM resolves the user from the session.
    url.searchParams.set('type', 'device')
    const body: Record<string, unknown> = {
      type: 'device',
      userCode: code,
      application: tenant.appName,
    }
    // `organization` scopes the application lookup (FindApplicationByName); it
    // does NOT resolve the user (that comes from the session), so pinning the
    // tenant org here is safe — unlike password login, which omits it.
    if (tenant.orgId) body.organization = tenant.orgId
    let res: Response
    try {
      res = await f(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
    } catch (e) {
      return { ok: false, error: String(e) }
    }
    let parsed: Record<string, unknown> = {}
    try {
      parsed = (await res.json()) as Record<string, unknown>
    } catch {
      return { ok: false, error: `HTTP ${res.status} non-JSON response` }
    }
    if (!res.ok || parsed.status === 'error') {
      return { ok: false, error: typeof parsed.msg === 'string' && parsed.msg ? parsed.msg : `HTTP ${res.status}` }
    }
    // Consent branch: {status:ok, data:{required:true}}. First-party apps skip
    // this; surface it so the caller can render consent rather than dead-ending.
    const data = parsed.data
    if (data !== null && typeof data === 'object' && (data as Record<string, unknown>).required === true) {
      return { ok: false, required: true }
    }
    return { ok: true }
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
    // POST the provider code to the IAM backend together with the app's ORIGINAL
    // OIDC authorize params (recovered from the round-tripped `state`). IAM
    // exchanges the provider code, signs the user in, and mints an authorization
    // code BOUND TO THE APP'S request — the app's client_id and, crucially, its
    // PKCE `code_challenge` (C1) — which we then hand back to the originating app
    // so its OWN callback exchanges the code with ITS verifier (V1). The minted
    // code is bound to C1, so that exchange matches; this is the keystone of the
    // social-login PKCE round-trip.
    const oidc = new URLSearchParams(req.oidcQuery.replace(/^\?/, ''))
    const appRedirectUri = oidc.get('redirect_uri') ?? ''
    const appState = oidc.get('state') ?? ''

    const url = new URL('/v1/iam/login', tenant.iamUrl)
    // OIDC params ride the QUERY — IAM's HandleLoggedIn reads them there first
    // when minting the code. Forward exactly the app's request so the code
    // carries its client_id, scope, nonce and — load-bearing — its
    // `code_challenge`. (`redirect_uri` snake-case is NOT forwarded: IAM reads
    // the code's redirect binding from camelCase `redirectUri`, set below.)
    for (const [k, v] of oidc) {
      if (['client_id', 'response_type', 'scope', 'state', 'nonce', 'code_challenge', 'code_challenge_method'].includes(k)) {
        url.searchParams.set(k, v)
      }
    }
    // Bind the minted code to the APP's redirect_uri (camelCase `redirectUri` —
    // the param HandleLoggedIn reads), so the code targets the app, NOT the
    // provider-callback host carried in the body below.
    if (appRedirectUri) url.searchParams.set('redirectUri', appRedirectUri)

    // The redirect_uri IAM forwards to the PROVIDER's token endpoint MUST be
    // byte-identical to the hop's redirect_uri — the provider's REGISTERED
    // callback host (`oauthCallbackOrigin`, e.g. `iam.hanzo.ai`, shared across
    // brand portals) — or the provider rejects the exchange `invalid_grant`.
    // This is a DIFFERENT redirect_uri from the app's above: one drives the
    // provider exchange (body), one binds the minted app code (query).
    const callbackOrigin = tenant.oauthCallbackOrigin ?? tenant.publicOrigin
    const res = await f(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        type: 'code',
        application: req.application,
        provider: req.provider,
        code: req.code,
        // IAM's social state guard accepts state == application name.
        state: req.application,
        redirectUri: `${callbackOrigin}/callback`,
        // "signup" = find-or-create-LOGIN (see social.ts); never the link branch.
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
    // IAM returns the freshly-minted authorization CODE in `data` (codeToResponse
    // → the bare code string, NOT a URL). Build the redirect back to the app's
    // own redirect_uri + original state so the app runs the standard OIDC code
    // exchange. (Treating the bare code AS the redirect URL — the prior bug —
    // dead-ended the flow on the issuer host and never returned to the app.)
    const code = typeof body.data === 'string' ? body.data : ''
    if (!code) return { error: 'provider login returned no authorization code' }
    if (!appRedirectUri) return { error: 'provider login: missing redirect_uri in social state' }
    const sep = appRedirectUri.includes('?') ? '&' : '?'
    return {
      redirectUrl: `${appRedirectUri}${sep}code=${encodeURIComponent(code)}&state=${encodeURIComponent(appState)}`,
    }
  }

  return { tenant, login, silentLogin, approveDevice, signup, forgot, authorize, exchange, logout, getAppLogin, providerLogin }
}

/**
 * Canonicalize a user-entered device code to the form IAM generated. IAM mints
 * codes from `[0-9a-z]{6}` (`util.GetRandomName`), so we lowercase (making entry
 * case-insensitive), trim surrounding whitespace, and drop spaces/dashes a user
 * might add while transcribing. The DeviceAuthMap key is the exact string, so we
 * normalize TO that lowercase alphabet — never uppercase.
 */
function normalizeUserCode(raw: string): string {
  // IAM mints user_codes from an UPPERCASE unambiguous alphabet
  // ([A-HJ-NP-Z2-9], no I/L/O/0/1) and keys its DeviceAuthMap on the exact
  // string. A human may transcribe it lower-cased or with stray spaces/dashes,
  // so normalize TO uppercase and strip separators — case-insensitive entry,
  // an exact-match send.
  return raw.trim().toUpperCase().replace(/[\s-]+/g, '')
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
      // The provider's IDENTITY is the nested provider record's name
      // (`rec.provider.name`, e.g. `provider-github`) — that is what the IAM
      // backend's social-login lookup (`GetProvider(admin/<name>)`) resolves.
      // The OUTER link object's `name` is the app's provider-LINK label, which
      // some Casdoor seeds set to a per-app default (e.g. `<org>-iam`); reading
      // it as the provider name made the hop POST `provider=<org>-iam`, which
      // the backend rejects ("The provider: <org>-iam does not exist"). Prefer
      // the inner record name; fall back to the outer label only when there is
      // no nested provider record. One source of truth: the provider record.
      const inner =
        typeof rec.provider === 'object' && rec.provider !== null
          ? (rec.provider as Record<string, unknown>)
          : {}
      const innerName = typeof inner.name === 'string' ? inner.name : ''
      const outerName = typeof rec.name === 'string' ? rec.name : ''
      const name = innerName || outerName
      if (!name) return null
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
