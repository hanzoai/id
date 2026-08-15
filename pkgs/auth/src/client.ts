import type { OrgConfig } from '@hanzo/id-shared'
import type { Chain } from '@hanzo/id-connect'
import { offeredWalletChains } from './web3'
import type {
  AppLogin,
  AppProvider,
  DeviceApprovalResult,
  DeviceInfoResult,
  FederationMfaRequest,
  CodeRequest,
  LoginRequest,
  LoginResponse,
  MfaChallengeRequest,
  MfaChannel,
  MfaIdentity,
  MfaSetup,
  MfaEnrolled,
  OAuthAuthorizeRequest,
  SetPasswordRequest,
  SignupRequest,
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
 * downstream pages call `.login()`, `.signup()`, `.sendCode()`, `.authorize()`
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
   * Approve an RFC 8628 device-authorization request from the device-approval
   * page (`/login/oauth/device`). The user MUST already be signed in to the
   * issuer — this rides the `iam_session_id` cookie
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
  /**
   * Send a one-time code to the account's own email address or phone number.
   *
   * ONE send for both callers: recovery asks for it so a person who has lost
   * their password can prove the address instead, and code sign-in asks for it so
   * they can sign in with what arrives. It is one endpoint minting one record, so
   * a second method would only be a second way to spell it.
   *
   * `ok:false` always carries IAM's own sentence — "verification codes cannot be
   * delivered: no notify service is configured", "email is invalid" — because
   * that sentence is the only thing the person can act on.
   */
  sendCode(req: CodeRequest): Promise<{ ok: boolean; error?: string }>
  /**
   * Set a new password — `PUT /v1/iam/password`, the ONE place a person's own
   * password is written. It mints nothing: a reset is followed by an ordinary
   * {@link login} with the new password, second factor included.
   *
   * Prove it with the code {@link sendCode} delivered, or — signed in — with the
   * password being replaced. Exactly one, which the request type enforces.
   *
   * This is the half recovery was missing. A code got a person back IN through the
   * sign-in code arm and left the forgotten password forgotten — and left the
   * account lockout standing, because a code is a different credential with its own
   * bounded guesses. Only a reset retires the run of guesses against the old
   * password.
   */
  setPassword(req: SetPasswordRequest): Promise<{ ok: boolean; error?: string }>
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
   * Read the live login view of an application from `/v1/iam/get-app-login` —
   * what THIS APPLICATION offers (password, code, signup, its social providers),
   * each already masked by IAM with the capability behind it. Resolves to null when
   * the endpoint is unreachable, so a caller renders no method rather than a
   * guessed one.
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
   * The chain families a wallet may sign in with here.
   *
   * A SECOND read, deliberately, because it answers a different question than
   * {@link getAppLogin}: wallet sign-in is a capability of the IAM BINARY, not of
   * an application's config, so IAM publishes it on `/v1/iam/auth/methods` (from
   * the same list its nonce and verify endpoints gate on) and nowhere else. Empty
   * means no wallet — which is also what an unreadable answer means.
   */
  walletChains(clientId?: string): Promise<Chain[]>
  /**
   * Resolve the signed-in user's `{owner, name}` from the IAM session
   * (`/v1/iam/get-account`). After a `RequiredMfa` login the IAM session cookie
   * already authenticates the user (IAM calls `SetSessionUsername` before
   * answering `RequiredMfa`), so this is how the portal learns the identity to
   * key the forced-enrollment calls on. Resolves null when unauthenticated.
   */
  getAccount(): Promise<MfaIdentity | null>
  /**
   * Begin enrolling a factor: `POST /v1/iam/mfa/setup/initiate`. For `app` it
   * returns the secret + `otpauth://` URI to render as a QR. For `sms` and
   * `email` it SENDS a code to the address on the account and returns nothing to
   * show — the address is the factor, so receiving the code is the proof.
   * Persists nothing; only {@link mfaEnable} does.
   */
  mfaInitiate(req: MfaIdentity & { mfaType?: string }): Promise<MfaSetup>
  /**
   * Switch the factor on: `POST /v1/iam/mfa/setup/enable`. The passcode is
   * REQUIRED and is what proves possession — the passcode from the authenticator,
   * or the code that was just sent. IAM verifies it before writing anything, so
   * there is no separate check-my-code call to forget.
   *
   * On the account's FIRST factor the response carries the recovery codes, minted
   * by IAM and returned exactly once. Show them.
   */
  mfaEnable(req: MfaIdentity & { mfaType?: string; secret?: string; passcode: string }): Promise<MfaEnrolled>
  /**
   * Turn a factor off: `POST /v1/iam/mfa/disable`. Omit `mfaType` to drop every
   * factor on the account. Omit the identity to mean the caller — IAM authorizes
   * from the principal, so a person can always disarm their own second factor.
   *
   * IAM revokes the account's OTHER sessions on the way through, keeping this
   * one: changing what guards an account signs out the browsers that got in
   * under the old rule.
   */
  mfaDisable(req?: Partial<MfaIdentity> & { mfaType?: string }): Promise<void>
  /**
   * Answer a `NextMfa` challenge: `POST /v1/iam/login` with `{mfaType, passcode}`
   * and NO username, riding the MFA session cookie IAM set with `NextMfa`.
   * Returns the same shape as {@link login} (a redirect with an auth code for the
   * code flow, or a bare-session signal for portal sign-in).
   */
  mfaChallenge(req: MfaChallengeRequest): Promise<LoginResponse>
  /**
   * Answer the second factor for a sign-in that arrived through ANOTHER identity
   * provider: `POST /v1/iam/oauth/federation/mfa`, riding the httpOnly challenge
   * cookie IAM set when it parked the resume and sent the browser to /login/mfa.
   *
   * A separate call from {@link mfaChallenge} because the two resumes differ in
   * who holds the request: the password path re-sends the authorize params, while
   * here IAM pinned them and the browser has never seen them — so this body
   * carries the factor alone and the answer is a COMPLETE redirect back to the
   * relying party, not a code to append.
   */
  federationMfa(req: FederationMfaRequest): Promise<LoginResponse>
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
    // ONE credential goes on the wire, and which one IS the choice of arm — IAM
    // reads a code where a password goes and never reaches the password check when
    // one is present. Nothing else names the arm: the `signinMethod: 'Password'`
    // that used to sit here matches no field on IAM's loginForm, so the decoder
    // dropped it, and leaving it told the next person a code needs a different
    // value here. It does not.
    const body: Record<string, unknown> = {
      type,
      username: req.identifier,
      application: req.application,
      autoSignin: true,
      ...(req.code ? { code: req.code } : { password: req.password ?? '' }),
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
    // A username is IAM's to mint, not the browser's to guess. This used to post
    // `email.split('@')[0]`, which is not a username: `alice+hanzo@gmail.com` gave
    // `alice+hanzo`, and "+" is not in IAM's username charset, so one of the
    // commonest real address forms was refused outright — the form has no username
    // field, so there was nothing the person could change. And a local part someone
    // else already holds came back "username already exists" about that same
    // invisible field. Only the side that can see the directory can derive a name
    // and deduplicate it, so the address goes up and the name comes back.
    const res = await f(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        application: req.application,
        organization: req.organization,
        email: req.email,
        password: req.password,
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

  async function sendCode(req: CodeRequest): Promise<{ ok: boolean; error?: string }> {
    const url = new URL('/v1/iam/send-verification-code', org.iamUrl)
    // FORM-encoded, not JSON. This endpoint reads its fields with fiber's
    // FormValue — a HIP-0111 §4 invariant, and the one call in this client that
    // is not JSON. Posting JSON left every field unread, so IAM answered
    // "missing parameter: type" and the recovery page rendered the person a bare
    // "HTTP 400" for a request it never saw a field of.
    const res = await f(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        dest: req.dest,
        type: req.channel,
        applicationId: req.application,
      }).toString(),
    })
    // Read the envelope BEFORE branching on the status code. IAM sends its reason
    // in `msg` alongside a 400, so returning early on `!res.ok` threw away the
    // only sentence worth showing.
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (typeof body.msg === 'string' && (body.status === 'error' || !res.ok)) {
      return { ok: false, error: body.msg }
    }
    if (!res.ok || body.status === 'error') return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true }
  }

  async function setPassword(req: SetPasswordRequest): Promise<{ ok: boolean; error?: string }> {
    const url = new URL('/v1/iam/password', org.iamUrl)
    // One field per proof, and the type admits exactly one of them. A recovery names
    // the account because the person cannot be signed in; a rotation names nobody,
    // because IAM takes the subject from the session this call carries and never from
    // the body.
    const body: Record<string, unknown> =
      'code' in req
        ? { organization: req.organization, username: req.identifier, code: req.code, password: req.password }
        : { oldPassword: req.oldPassword, password: req.password }
    const res = await f(url.toString(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    })
    // The envelope before the status code, for the reason sendCode reads it that way:
    // IAM puts its one opaque refusal in `msg` alongside a 400, and that sentence is
    // the only thing the screen can honestly show.
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (typeof parsed.msg === 'string' && parsed.msg && (parsed.status === 'error' || !res.ok)) {
      return { ok: false, error: parsed.msg }
    }
    if (!res.ok || parsed.status === 'error') return { ok: false, error: `HTTP ${res.status}` }
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

  // The narrowing itself lives with the wallet flow (it is that module's business
  // what it can sign); this supplies the transport, so every IAM read in this
  // client goes through one fetch.
  const walletChains = (clientId?: string) => offeredWalletChains(org, clientId ?? org.clientId, f)

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
   * POST to `/v1/iam/mfa/setup/*` with the parameters as a JSON body.
   *
   * They used to ride the QUERY STRING with an empty body, justified by a v1
   * authz filter that only read `{owner,name}` from the query when the body was
   * empty. This server has no such filter — its MFA handlers authorize from the
   * PRINCIPAL (authz.From), so the identity on the request is the bearer's, not
   * something the URL asserts. Sending a body is the ordinary shape every other
   * call here uses, and IAM reads the body first.
   */
  async function mfaPost(path: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const url = new URL(`/v1/iam/mfa/${path}`, org.iamUrl)
    const res = await f(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(params),
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (typeof body.status === 'string' && body.status === 'error') {
      throw new Error(typeof body.msg === 'string' && body.msg ? body.msg : `HTTP ${res.status}`)
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return body
  }

  async function mfaInitiate(req: MfaIdentity & { mfaType?: string }): Promise<MfaSetup> {
    const mfaType = req.mfaType ?? MFA_TOTP
    const body = await mfaPost('setup/initiate', { owner: req.owner, name: req.name, mfaType })
    const d = (typeof body.data === 'object' && body.data ? body.data : {}) as Record<string, unknown>
    const secret = typeof d.secret === 'string' ? d.secret : ''
    const url = typeof d.url === 'string' ? d.url : ''
    // Only the authenticator hands back material to render. A texted or emailed
    // factor's material is the code that was just sent to the address on the
    // account, so there is nothing to show and nothing to echo back.
    if (mfaType === MFA_TOTP && (!secret || !url)) throw new Error('IAM returned no TOTP secret')
    return { mfaType, secret, url }
  }

  async function mfaEnable(req: MfaIdentity & { mfaType?: string; secret?: string; passcode: string }): Promise<MfaEnrolled> {
    try {
      const body = await mfaPost('setup/enable', {
        owner: req.owner,
        name: req.name,
        mfaType: req.mfaType ?? MFA_TOTP,
        secret: req.secret ?? '',
        passcode: req.passcode,
      })
      const d = (typeof body.data === 'object' && body.data ? body.data : {}) as Record<string, unknown>
      return {
        ok: true,
        // Minted by IAM and returned exactly once, on the first factor the account
        // adds. Whatever is shown here is the only copy the person will ever get.
        recoveryCodes: Array.isArray(d.recoveryCodes) ? d.recoveryCodes.filter((c): c is string => typeof c === 'string') : [],
      }
    } catch (e) {
      return { ok: false, recoveryCodes: [], error: e instanceof Error ? e.message : String(e) }
    }
  }

  async function mfaDisable(req: Partial<MfaIdentity> & { mfaType?: string } = {}): Promise<void> {
    // Omitting mfaType drops EVERY factor, which is IAM's contract and the only
    // way to turn two-factor off rather than swap channels. Omitting the identity
    // targets the caller — naming one is how an admin reaches somebody else.
    const params: Record<string, unknown> = {}
    if (req.owner) params.owner = req.owner
    if (req.name) params.name = req.name
    if (req.mfaType) params.mfaType = req.mfaType
    await mfaPost('disable', params)
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

  async function federationMfa(req: FederationMfaRequest): Promise<LoginResponse> {
    const url = new URL('/v1/iam/oauth/federation/mfa', org.iamUrl)
    const res = await f(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The challenge id is an httpOnly cookie IAM set on the callback, so the
      // credentials MUST travel; nothing in the body identifies the sign-in.
      credentials: 'include',
      body: JSON.stringify({ mfaType: req.mfaType, passcode: req.passcode }),
    })
    let body: Record<string, unknown> = {}
    try {
      body = (await res.json()) as Record<string, unknown>
    } catch {
      return { error: `HTTP ${res.status} non-JSON response` }
    }
    // IAM answers a refusal with HTTP 200 + status:"error", so the code proves
    // nothing on its own.
    if (!res.ok || body.status === 'error') {
      return { error: typeof body.msg === 'string' ? body.msg : `HTTP ${res.status}` }
    }
    // `data` is the finished redirect (redirect_uri?code&state) IAM built from the
    // PINNED authorize request. Handing it back as `redirectUrl` is what makes this
    // resume end the same way every other one does — the caller navigates and stops
    // thinking about which door the sign-in came through.
    if (typeof body.data !== 'string' || body.data === '') {
      return { error: 'the sign-in could not be completed' }
    }
    return { redirectUrl: body.data }
  }

  return {
    org,
    login,
    approveDevice,
    deviceInfo,
    signup,
    sendCode,
    setPassword,
    authorize,
    exchange,
    logout,
    signOut,
    getAppLogin,
    walletChains,
    getAccount,
    mfaInitiate,
    mfaEnable,
    mfaDisable,
    mfaChallenge,
    federationMfa,
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
  const application = typeof data.name === 'string' ? data.name : fallbackApp
  return {
    application,
    // The row's own id. IAM's OTP send resolves the application by (owner, name),
    // so the owner has to come from the descriptor: `admin/` was hardcoded here,
    // which is a guess that happens to hold for the seeded estate and mints
    // nothing for an application owned by anyone else.
    id: `${typeof data.owner === 'string' && data.owner ? data.owner : 'admin'}/${application}`,
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
