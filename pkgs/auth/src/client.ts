import type { OrgConfig } from '@hanzo/id-shared'
import type {
  AppLogin,
  AppProvider,
  DeviceApprovalResult,
  DeviceInfoResult,
  ForgotRequest,
  LoginRequest,
  LoginResponse,
  MfaChallengeRequest,
  MfaChannel,
  MfaIdentity,
  MfaSetup,
  OAuthAuthorizeRequest,
  SignupRequest,
  SilentLoginRequest,
  TokenResponse,
} from './types'

/** IAM's TOTP MFA type constant (`object.TotpType`). */
export const MFA_TOTP = 'app'

/** Map an IAM MFA type to the {@link MfaChannel} the OTP UI renders a label for. */
export function mfaChannelOf(iamType: string): MfaChannel {
  return iamType === 'sms' ? 'sms' : iamType === 'email' ? 'email' : 'totp'
}

/**
 * Composable IAM client.
 *
 * Stateless wrapper around the canonical IAM REST surface (paths under
 * `/v1/iam/*` and the OIDC paths under `/v1/iam/oauth/*`). One
 * client instance per org. The portal creates one in `createRoot()`;
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
  readonly org: OrgConfig
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
   * plus the org's `application`/`organization`; IAM resolves the user from
   * the session, flips the device code's `UserSignIn=true`, and the CLI's token
   * poll then succeeds. Returns `{required:true}` when the app needs consent
   * first (rare for first-party apps), or `{error}` with the IAM message.
   */
  approveDevice(userCode: string): Promise<DeviceApprovalResult>
  /**
   * Name the application a pending device code belongs to, so the approval page
   * can say WHICH app it is authorizing — `GET
   * /v1/iam/oauth/device/<user_code>`, riding the same `iam_session_id` cookie
   * as {@link approveDevice}.
   *
   * Read this and render it; never `org.appName`, which is this portal's own
   * branding and names a different application than the one that minted the
   * code. IAM answers from the code's own application row.
   *
   * Session-gated and deliberately terse: an expired session comes back as
   * `loginRequired`, and unknown / expired / already-approved all come back as
   * ONE indistinguishable refusal, because a user_code is 40 bits and an
   * endpoint that told them apart would be an oracle for hunting live codes.
   */
  deviceInfo(userCode: string): Promise<DeviceInfoResult>
  signup(req: SignupRequest): Promise<LoginResponse>
  forgot(req: ForgotRequest): Promise<{ ok: boolean; error?: string }>
  authorize(req: OAuthAuthorizeRequest): string
  exchange(code: string, codeVerifier?: string): Promise<TokenResponse>
  logout(idTokenHint?: string, postLogoutRedirectUri?: string): string
  /**
   * Sign out COMPLETELY: drop this browser's own tokens, then hand back the
   * IdP's RP-initiated logout URL for the caller to navigate to.
   *
   * `logout()` alone is only half of it, and the missing half is the half a
   * person notices. It builds the IdP URL, which ends the session at the
   * server — measured, the access token really is revoked there — but it
   * touches nothing this browser stored, so `hanzo_iam_access_token` and its
   * siblings survive a sign-out. Anything that treats the presence of that key
   * as "signed in" then still believes you are (hanzoai/playground's AuthGuard
   * reads exactly that key), and a token string that outlives its session is a
   * thing to delete on principle even where nothing reads it.
   *
   * So sign-out is ONE call, not a URL plus a cleanup every caller has to
   * remember. Local first, then the redirect: a navigation ends this
   * document, and anything left after `location.href` is a coin flip.
   */
  signOut(postLogoutRedirectUri?: string): string
  /**
   * Read the live enabled-auth-methods view for an application from
   * `/v1/iam/get-app-login` — the canonical source of truth for which
   * sign-in buttons (password / GitHub / Google / Web3) to render.
   * Resolves to null when the endpoint is unreachable so callers can fall
   * back to the org's declared default method set.
   *
   * `redirectUri` is validated by IAM against the app's registered list. For a
   * cross-app SSO read (e.g. console → hanzo.id, `clientId=hanzo-cloud`) pass the
   * DOWNSTREAM app's own OIDC `redirect_uri` — the portal's `/callback` is NOT in
   * that app's list, so hardcoding it makes IAM answer `status:error`
   * ("Redirect URI … doesn't exist in the allowed list") and drops the whole
   * response. Omit it for a bare/own-app read (defaults to the portal callback).
   */
  getAppLogin(clientId?: string, redirectUri?: string): Promise<AppLogin | null>
  /**
   * Resolve the signed-in user's `{owner, name}` from the IAM session
   * (`/v1/iam/get-account`). After a `RequiredMfa` login the IAM session cookie
   * already authenticates the user (IAM calls `SetSessionUsername` before
   * answering `RequiredMfa`), so this is how the portal learns the identity to
   * key the forced-enrollment calls on. Resolves null when unauthenticated.
   */
  getAccount(): Promise<MfaIdentity | null>
  /**
   * Begin TOTP enrollment: `POST /v1/iam/mfa/setup/initiate`. Returns the secret
   * + `otpauth://` URI + recovery codes. Does NOT persist anything — only
   * {@link mfaEnable} does.
   */
  mfaInitiate(id: MfaIdentity): Promise<MfaSetup>
  /** Verify a TOTP code against a pending secret: `POST /v1/iam/mfa/setup/verify`. */
  mfaVerify(req: MfaIdentity & { secret: string; passcode: string }): Promise<{ ok: boolean; error?: string }>
  /** Persist a verified TOTP enrollment: `POST /v1/iam/mfa/setup/enable`. */
  mfaEnable(req: MfaIdentity & { secret: string; recoveryCode: string }): Promise<{ ok: boolean; error?: string }>
  /**
   * Answer a `NextMfa` challenge: `POST /v1/iam/login` with `{mfaType, passcode}`
   * and NO username, riding the MFA session cookie IAM set with `NextMfa`.
   * Returns the same shape as {@link login} (a redirect with an auth code for the
   * code flow, or a bare-session signal for portal sign-in).
   */
  mfaChallenge(req: MfaChallengeRequest): Promise<LoginResponse>
}

export interface AuthClientOptions {
  readonly org: OrgConfig
  /** Override fetch impl (testing). Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch
}

export function createAuthClient(opts: AuthClientOptions): AuthClient {
  const org = opts.org
  const f = opts.fetchImpl ?? fetch

  async function login(req: LoginRequest): Promise<LoginResponse> {
    const type = req.redirectUri ? 'code' : 'login'
    const url = new URL('/v1/iam/login', org.iamUrl)
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

  // Resolve the org of the user in the ambient IAM session (the `iam_session_id`
  // cookie), or null when there is no live session. Reads `/v1/iam/get-account`;
  // the org is the `owner` field (IAM returns the User at the top level or
  // under `data`). Used to keep silent SSO from reusing a session that belongs
  // to a DIFFERENT org than the app being signed into.
  async function sessionOwner(): Promise<string | null> {
    try {
      const res = await f(new URL('/v1/iam/get-account', org.iamUrl).toString(), {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) return null
      const body = (await res.json()) as Record<string, unknown>
      if (body.status === 'error') return null
      const nested = (typeof body.data === 'object' && body.data ? body.data : {}) as Record<string, unknown>
      const owner = typeof body.owner === 'string' ? body.owner : nested.owner
      return typeof owner === 'string' && owner ? owner : null
    } catch {
      return null
    }
  }

  async function silentLogin(req: SilentLoginRequest): Promise<LoginResponse> {
    // Silent SSO may reuse the ambient IAM session ONLY when that session's user
    // belongs to the SAME org as the app being signed into. A cross-org app —
    // e.g. the admin-guard (client_id=hanzo-admin-guard, org=admin) reached from
    // a browser that already holds a hanzo/* session — must NOT mint a code from
    // the wrong-org session: that confers owner=hanzo and silently shadows the
    // org-scoped credential form (which resolves the admin/* identity). Resolve
    // the app's org and the session owner; on no session or an org mismatch,
    // return an empty response so Login.tsx falls back to the interactive form,
    // which authenticates in the app's own org. Same-org SSO (the common case)
    // still mints silently, so seamless sign-in is preserved.
    const [app, owner] = await Promise.all([getAppLogin(req.clientId), sessionOwner()])
    if (!owner) return {}
    const appOrg = app?.organization
    if (appOrg && owner !== appOrg) return {}

    const url = new URL('/v1/iam/login', org.iamUrl)
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
    const url = new URL('/v1/iam/login', org.iamUrl)
    // IAM's device branch keys the cache off the `userCode` in the BODY; the
    // `type` echo on the query mirrors the other login legs. NO credentials —
    // the user is already signed in, so this rides the session cookie
    // (`credentials:'include'`) and IAM resolves the user from the session.
    url.searchParams.set('type', 'device')
    const body: Record<string, unknown> = {
      type: 'device',
      userCode: code,
      application: org.appName,
    }
    // `organization` scopes the application lookup (FindApplicationByName); it
    // does NOT resolve the user (that comes from the session), so pinning the
    // org org here is safe — unlike password login, which omits it.
    if (org.orgId) body.organization = org.orgId
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

  async function deviceInfo(userCode: string): Promise<DeviceInfoResult> {
    const code = normalizeUserCode(userCode)
    if (!code) return { ok: false, error: 'Enter the code shown on your device.' }
    // POST, and the code rides the BODY — like `approveDevice` beside it, and for
    // the reason IAM's own introspection endpoint is POST: the user_code is the one
    // secret in this flow, and a request line is copied into ingress and proxy
    // access logs where a body is not. This page ships `scrubUrl()` to keep the
    // code out of the address bar; putting it into every request line would undo
    // that server-side. Same session cookie as the approval: whatever you may look
    // at is exactly what you may approve.
    const url = new URL('/v1/iam/oauth/device/info', org.iamUrl)
    let res: Response
    try {
      res = await f(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userCode: code }),
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
      const error = typeof parsed.msg === 'string' && parsed.msg ? parsed.msg : `HTTP ${res.status}`
      // IAM `CodeLoginRequired` (internal/oidc/oidc.go): the session lapsed between
      // the page's get-account check and this read. Not a dead end — sign in again.
      if (parsed.code === 'login_required') return { ok: false, error, loginRequired: true }
      return { ok: false, error }
    }
    // A name is only worth rendering if the server sent it. An answer with no
    // clientId names nothing, so it fails rather than letting the page fall back
    // to a guess — showing the WRONG application is the defect this endpoint exists
    // to fix. `displayName` falls back to the clientId, which IAM did confirm.
    const data = parsed.data as Record<string, unknown> | undefined
    const clientId = typeof data?.clientId === 'string' ? data.clientId : ''
    const displayName = typeof data?.displayName === 'string' ? data.displayName : ''
    if (!clientId) return { ok: false, error: 'IAM did not name the application for this code.' }
    return { ok: true, clientId, displayName: displayName || clientId }
  }

  async function signup(req: SignupRequest): Promise<LoginResponse> {
    const url = new URL('/v1/iam/signup', org.iamUrl)
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
        ...(req.inviteCode ? { invitationCode: req.inviteCode } : {}),
      }),
    })

    // Registration is CREATE-ONLY at IAM. `/v1/iam/signup` persists the user and
    // answers with the created row — it sets no session cookie and mints no
    // authorization code, and its form (`internal/oidc/signup.go`) has no
    // `autoSignin`, `redirectUri` or `code_challenge` field to make it do so.
    // The `autoSignin: true` this used to post was silently dropped by the Go
    // decoder, so "signed up" and "signed in" were never the same event.
    //
    // Left there, the response fell through `parseLoginResponse`'s no-redirect
    // arm to `{ redirectUrl: '/onboarding' }` — every new customer was sent to
    // the portal's own onboarding, unauthenticated, while the app that sent them
    // waited on a code that was never minted. So finish the job here: a signup
    // that leaves you logged out is not a signup.
    const created = await parseCreated(res)
    if (created.error) return created

    return login({
      identifier: req.email,
      password: req.password,
      clientId: req.clientId,
      application: req.application,
      organization: req.organization,
      redirectUri: req.redirectUri,
      state: req.state,
      codeChallenge: req.codeChallenge,
      codeChallengeMethod: req.codeChallengeMethod,
      nonce: req.nonce,
    })
  }

  async function forgot(req: ForgotRequest): Promise<{ ok: boolean; error?: string }> {
    const url = new URL('/v1/iam/send-verification-code', org.iamUrl)
    url.searchParams.set('clientId', req.clientId)
    url.searchParams.set('organization', req.organization)
    const res = await f(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        applicationId: `admin/${org.appName}`,
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
    const url = new URL('/v1/iam/oauth/authorize', org.iamUrl)
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
    // Naming a provider federates the request to that external IdP instead of
    // the hosted credential login. The type has always declared this field;
    // never emitting it is why social sign-in had no server side at all.
    if (req.provider) url.searchParams.set('provider', req.provider)
    return url.toString()
  }

  async function exchange(code: string, codeVerifier?: string): Promise<TokenResponse> {
    const url = new URL('/v1/iam/oauth/token', org.iamUrl)
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: org.clientId,
      redirect_uri: `${org.publicOrigin}/callback`,
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
    const url = new URL('/v1/iam/oauth/logout', org.iamUrl)
    if (idTokenHint) url.searchParams.set('id_token_hint', idTokenHint)
    url.searchParams.set(
      'post_logout_redirect_uri',
      postLogoutRedirectUri ?? `${org.publicOrigin}/login`,
    )
    return url.toString()
  }

  function signOut(postLogoutRedirectUri?: string): string {
    // Every key the SDK owns is namespaced `hanzo_iam_*` — access_token,
    // expires_at, state, code_verifier, current_org, current_project,
    // post_login_redirect. Sweep the PREFIX rather than naming them: a list of
    // literals here is a second copy of the SDK's key set, and the copy is what
    // goes stale when the SDK adds one. The prefix is the contract.
    //
    // Both storages. The token lives in sessionStorage, but the PKCE verifier
    // is deliberately in localStorage (it has to survive the full-page redirect
    // to the IdP), and apps cache the token there too.
    for (const store of [
      typeof sessionStorage !== 'undefined' ? sessionStorage : null,
      typeof localStorage !== 'undefined' ? localStorage : null,
    ]) {
      if (!store) continue
      // Collect first, then delete: removing while iterating by index
      // re-indexes the store and skips every other key.
      const doomed: string[] = []
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i)
        if (k && k.startsWith('hanzo_iam_')) doomed.push(k)
      }
      for (const k of doomed) store.removeItem(k)
    }
    return logout(undefined, postLogoutRedirectUri)
  }

  async function getAppLogin(clientId?: string, redirectUri?: string): Promise<AppLogin | null> {
    const id = clientId ?? org.clientId
    const url = new URL('/v1/iam/get-app-login', org.iamUrl)
    url.searchParams.set('clientId', id)
    url.searchParams.set('responseType', 'code')
    // Validate against the downstream app's OWN redirect_uri when the caller has
    // one (the SSO authorize flow carries it); the portal's own /callback is not
    // registered for another app, so IAM would reject the read and we'd surface
    // no social buttons. Fall back to the portal callback for a bare/own read.
    url.searchParams.set('redirectUri', redirectUri || `${org.publicOrigin}/callback`)
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
    return parseAppLogin(body.data as Record<string, unknown>, org.appName, org.orgId)
  }

  async function getAccount(): Promise<MfaIdentity | null> {
    const url = new URL('/v1/iam/get-account', org.iamUrl)
    let body: Record<string, unknown>
    try {
      const res = await f(url.toString(), { headers: { Accept: 'application/json' }, credentials: 'include' })
      if (!res.ok) return null
      body = (await res.json()) as Record<string, unknown>
    } catch {
      return null
    }
    const d = (typeof body.data === 'object' && body.data ? body.data : {}) as Record<string, unknown>
    if (typeof d.owner !== 'string' || typeof d.name !== 'string' || !d.owner || !d.name) return null
    return { owner: d.owner, name: d.name }
  }

  /**
   * Build a `/v1/iam/mfa/setup/*` POST URL with EVERY param on the query string
   * and send an EMPTY body. This is the one wire shape IAM's authz filter and
   * the MFA controller both accept: the controller reads `owner`/`name`/… from
   * the merged form (query + body), while the authz filter only extracts the
   * `{owner,name}` object from the query when the body is empty (a non-empty
   * body is JSON-unmarshalled, and a urlencoded body fails that parse → empty
   * object → the self-access match `sub==obj` fails → "Unauthorized operation").
   * `owner`/`name` ride the query on EVERY call — including `verify`, which
   * otherwise carries no identity — purely so that self-access check passes.
   */
  async function mfaSetupPost(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const url = new URL(`/v1/iam/mfa/setup/${path}`, org.iamUrl)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    const res = await f(url.toString(), { method: 'POST', credentials: 'include' })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (typeof body.status === 'string' && body.status === 'error') {
      throw new Error(typeof body.msg === 'string' && body.msg ? body.msg : `HTTP ${res.status}`)
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return body
  }

  async function mfaInitiate(id: MfaIdentity): Promise<MfaSetup> {
    const body = await mfaSetupPost('initiate', { owner: id.owner, name: id.name, mfaType: MFA_TOTP })
    const d = (typeof body.data === 'object' && body.data ? body.data : {}) as Record<string, unknown>
    const secret = typeof d.secret === 'string' ? d.secret : ''
    const url = typeof d.url === 'string' ? d.url : ''
    if (!secret || !url) throw new Error('IAM returned no TOTP secret')
    return {
      mfaType: MFA_TOTP,
      secret,
      url,
      recoveryCodes: Array.isArray(d.recoveryCodes) ? d.recoveryCodes.filter((c): c is string => typeof c === 'string') : [],
    }
  }

  async function mfaVerify(req: MfaIdentity & { secret: string; passcode: string }): Promise<{ ok: boolean; error?: string }> {
    try {
      await mfaSetupPost('verify', { owner: req.owner, name: req.name, mfaType: MFA_TOTP, secret: req.secret, passcode: req.passcode })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async function mfaEnable(req: MfaIdentity & { secret: string; recoveryCode: string }): Promise<{ ok: boolean; error?: string }> {
    try {
      await mfaSetupPost('enable', {
        owner: req.owner,
        name: req.name,
        mfaType: MFA_TOTP,
        secret: req.secret,
        recoveryCodes: req.recoveryCode,
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async function mfaChallenge(req: MfaChallengeRequest): Promise<LoginResponse> {
    const type = req.redirectUri ? 'code' : 'login'
    const url = new URL('/v1/iam/login', org.iamUrl)
    url.searchParams.set('clientId', req.clientId)
    url.searchParams.set('responseType', 'code')
    if (req.redirectUri) url.searchParams.set('redirectUri', req.redirectUri)
    url.searchParams.set('scope', 'openid profile email')
    if (req.state) url.searchParams.set('state', req.state)
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
        // No username: IAM resolves the user from the MFA session cookie it set
        // when it answered NextMfa.
        mfaType: req.mfaType,
        passcode: req.passcode,
        application: req.application,
        organization: req.organization,
        enableMfaRemember: req.rememberDevice ?? false,
      }),
    })
    return parseLoginResponse(res, req)
  }

  return {
    org,
    login,
    silentLogin,
    approveDevice,
    deviceInfo,
    signup,
    forgot,
    authorize,
    exchange,
    logout,
    signOut,
    getAppLogin,
    getAccount,
    mfaInitiate,
    mfaVerify,
    mfaEnable,
    mfaChallenge,
  }
}

/**
 * Canonicalize a user-entered device code to the form IAM generated. IAM mints
 * user_codes from an UPPERCASE unambiguous alphabet ([A-HJ-NP-Z2-9], no
 * I/L/O/0/1) and keys its DeviceAuthMap on the exact string. A human may
 * transcribe it lower-cased or with stray spaces/dashes, so normalize TO
 * uppercase and strip separators — case-insensitive entry, an exact-match send.
 */
function normalizeUserCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]+/g, '')
}

/**
 * The provider's DISPLAY key — `provider-github` → `github` — used to pick an
 * icon and a label (`PROVIDER_META`) and to match a `provider_hint`.
 *
 * It is NOT what the authorize endpoint wants. `federationProvider` matches the
 * record name exactly, so `?provider=` must carry the full `provider-github`;
 * live, `?provider=github` is refused "unknown or unavailable provider". This
 * comment used to assert the opposite — a bare key — which was never true of the
 * federation broker.
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
      // some IAM seeds set to a per-app default (e.g. `<org>-iam`); reading
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

/**
 * Read a create-only IAM response: `{status, msg, data}` where `data` is the
 * created row. Success carries nothing the caller can navigate to, so this
 * reports only whether it worked — never a redirect. Kept separate from
 * `parseLoginResponse` precisely because that one INVENTS a destination when no
 * `redirectUri` was requested, which is wrong for a row that is not a session.
 */
async function parseCreated(res: Response): Promise<{ error?: string }> {
  let body: Record<string, unknown> = {}
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    return { error: `HTTP ${res.status} non-JSON response` }
  }
  // IAM answers a REFUSAL with HTTP 200 + status:"error" (see the org-less login
  // note in this repo's LLM.md), so the status code alone proves nothing.
  if (!res.ok || body.status === 'error') {
    return { error: typeof body.msg === 'string' ? body.msg : `HTTP ${res.status}` }
  }
  return {}
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

  // Multi-factor signal — IAM answers a successful credential check with a
  // STRING in `data` (NOT a `mfa_required` boolean): `"RequiredMfa"` when org
  // policy forces MFA the user has not enrolled, `"NextMfa"` when the user has
  // MFA and must answer a challenge. Branch BEFORE any session/redirect return:
  // the password session is not yet usable, so the portal must render the
  // enrollment/challenge step rather than navigate on.
  if (data === 'RequiredMfa') {
    return { mfaRequired: true, mfaStage: 'enroll' }
  }
  if (data === 'NextMfa') {
    // Challenge allow-list: IAM's named `mfa` field first, falling back to
    // the legacy untyped `data2` slot until IAM stops emitting it.
    const allow = Array.isArray(body.mfa) ? body.mfa : Array.isArray(body.data2) ? body.data2 : []
    const mfaTypes = allow
      .map((p) => (typeof p === 'object' && p !== null ? (p as Record<string, unknown>).mfaType : undefined))
      .filter((t): t is string => typeof t === 'string' && t.length > 0)
    return { mfaRequired: true, mfaStage: 'challenge', mfaTypes }
  }

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
  }
}
