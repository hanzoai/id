export interface LoginRequest {
  readonly identifier: string
  /**
   * The credential. Exactly one of these two is sent, and IAM chooses the arm by
   * which one is non-empty (`internal/oidc/login.go`: "One credential is
   * required, not specifically a password: a code stands in its place").
   *
   * A code delivered to the account's own email address or phone number proves
   * possession of that address, which is one factor exactly as a password is —
   * so it enters the SAME endpoint and inherits the MFA gate, the device approval
   * and the PKCE tail rather than getting a second login path.
   */
  readonly password?: string
  readonly code?: string
  readonly clientId: string
  readonly application: string
  /**
   * Org-resolution anchor for the credential lookup. OPTIONAL by design.
   *
   * IAM resolves the user by (org, identifier); if the in-org lookup misses it
   * falls back to a CROSS-ORG lookup by email/username and the session always
   * encodes the user's REAL owner-org (`GetOrganizationByUser`), never this
   * value. So this field is a lookup HINT, not the session's org.
   *
   * Leaving it empty/undefined makes login ORG-AGNOSTIC: every in-org lookup
   * misses, the cross-org fallback runs, and an identity that lives in the
   * global `admin` org (a global admin) resolves to `admin` (→ full multi-org
   * session) while a brand-only identity resolves to its own brand org. This is
   * why the portal does NOT pin the brand org here — pinning `hanzo` would
   * resolve a colliding `hanzo/<name>` row and truncate a global admin to one
   * org. Set it only to FORCE a specific org (e.g. a brand that deliberately
   * scopes its portal to a single org). Signup, by contrast, MUST carry a
   * concrete org (you cannot create a user in "no org").
   */
  readonly organization?: string
  readonly redirectUri?: string
  readonly state?: string
  readonly codeChallenge?: string
  readonly codeChallengeMethod?: 'S256' | 'plain'
  /**
   * OIDC nonce from the downstream authorize request. MUST be threaded through
   * the password-login path so the minted code (and resulting id_token) echo it.
   * Confidential OIDC clients that validate strictly (e.g. LibreChat /
   * openid-client with OPENID_REUSE_TOKENS) reject an id_token whose nonce
   * doesn't match the one they sent -> "unexpected JWT claim value" -> callback
   * 500. Forward, never default — only echo what the authorize URL carried.
   */
  readonly nonce?: string
}

/** A multi-factor channel the portal can render a code entry for. */
export type MfaChannel = 'totp' | 'sms' | 'email'

export interface LoginResponse {
  readonly accessToken?: string
  readonly refreshToken?: string
  readonly idToken?: string
  readonly expiresAt?: number
  readonly redirectUrl?: string
  /**
   * Set when IAM answered the login with a multi-factor signal instead of a
   * session/code. `mfaStage` discriminates the two IAM states:
   *   - `'enroll'`  — IAM returned `data:"RequiredMfa"`: org policy forces MFA
   *     and the user has none yet → render forced TOTP enrollment.
   *   - `'challenge'` — IAM returned `data:"NextMfa"`: the user has MFA enabled
   *     → render a code challenge for one of `mfaTypes`.
   * The password session is NOT established until the enrollment/challenge
   * completes, so the portal must not navigate past this signal.
   */
  readonly mfaRequired?: boolean
  readonly mfaStage?: 'enroll' | 'challenge'
  /**
   * The IAM MFA types available for a `'challenge'` (from the login response's
   * named `mfa` field, legacy `data2`), in IAM's own vocabulary: `app` (TOTP),
   * `sms`, `email`. Empty for enrollment.
   */
  readonly mfaTypes?: readonly string[]
  /**
   * The wallet address IAM verified, on a wallet flow only. It is the address
   * taken from the SIGNED message, not the one the client asked about, so it is
   * the address actually bound — which is what a caller may show or record.
   */
  readonly walletAddress?: string
  readonly error?: string
}

/**
 * Result of approving an RFC 8628 device-authorization request
 * ({@link AuthClient.approveDevice}).
 *
 * `ok` — the device code was marked signed-in (the CLI's token poll now
 * succeeds). `required` — the application needs the user to grant consent
 * before approval can complete (`{status:ok, data:{required:true}}`); rare for
 * first-party apps. `error` — the IAM-surfaced failure message (e.g.
 * "UserCode Expired", "DeviceCode Invalid").
 */
export interface DeviceApprovalResult {
  readonly ok: boolean
  readonly required?: boolean
  readonly error?: string
}

/**
 * WHICH application a pending device code belongs to
 * ({@link AuthClient.deviceInfo}) — the one thing the approval page exists to
 * tell a human, and the one thing it cannot know on its own.
 *
 * Both fields come off the device code's own application row, so a page that
 * renders them names the party it is actually authorizing. They are the ONLY
 * honest source: `org.appName` is this portal's static branding and names the
 * wrong app for every code minted by anything else.
 *
 * Discriminated on `ok` so a caller cannot read `displayName` without having
 * proved the server confirmed one. `loginRequired` singles out the expired
 * session (IAM `code:"login_required"`) — the page's cue to sign the human in
 * and come back, not an error to show. Every other failure is IAM's single
 * opaque refusal, surfaced verbatim.
 */
export type DeviceInfoResult =
  | { readonly ok: true; readonly clientId: string; readonly displayName: string }
  | { readonly ok: false; readonly error: string; readonly loginRequired?: boolean }

/**
 * What `/v1/iam/mfa/setup/initiate` hands back for the person to prove they hold
 * the factor. For `app` that is the secret + `url` (an `otpauth://` URI),
 * rendered locally as a QR so the secret never leaves the browser. For `sms` and
 * `email` both are empty: the material is the code IAM just sent to the address
 * on the account.
 *
 * Recovery codes are deliberately NOT here. They arrive from `enable`, once, when
 * the factor is actually switched on — an enrolment that was abandoned never had
 * any.
 */
export interface MfaSetup {
  /** IAM MFA type — `app` (TOTP), `sms`, or `email`. */
  readonly mfaType: string
  /** Base32 TOTP secret (`app` only). */
  readonly secret: string
  /** `otpauth://totp/...` provisioning URI for the authenticator app (`app` only). */
  readonly url: string
}

/**
 * The outcome of switching a factor on. `recoveryCodes` is non-empty only on the
 * account's FIRST factor: IAM mints them there and returns them exactly once, so
 * this is the only chance to show them.
 */
export interface MfaEnrolled {
  readonly ok: boolean
  readonly recoveryCodes: readonly string[]
  readonly error?: string
}

/** The signed-in user's identity, resolved from the IAM session for MFA setup. */
export interface MfaIdentity {
  readonly owner: string
  readonly name: string
}

/**
 * The second factor for a sign-in that came in through ANOTHER identity provider
 * (Google, GitHub) and was parked at IAM's federation challenge.
 *
 * It carries the factor and NOTHING else — no user, no application, no
 * redirect_uri — because IAM pinned all of that server-side when it parked the
 * resume, and the challenge id rides an httpOnly cookie. That is the whole
 * difference from {@link MfaChallengeRequest}: the password path re-sends the
 * authorize request because the browser owns it; here the browser has never seen
 * it and must not be able to name it.
 */
export interface FederationMfaRequest {
  /** IAM MFA type — `app` (TOTP) is what the federation resume verifies. */
  readonly mfaType: string
  readonly passcode: string
}

/** A TOTP challenge submission for a user who already enrolled (`NextMfa`). */
export interface MfaChallengeRequest {
  /** IAM MFA type, e.g. `app` (TOTP), `sms`, `email`. */
  readonly mfaType: string
  readonly passcode: string
  readonly clientId: string
  readonly application: string
  readonly organization: string
  readonly redirectUri?: string
  readonly state?: string
  readonly codeChallenge?: string
  readonly codeChallengeMethod?: 'S256' | 'plain'
  /** Honor the org's "remember this device" window after a successful code. */
  readonly rememberDevice?: boolean
}

/**
 * What a registration hands back: the sign-in that followed it, plus WHO was
 * created.
 *
 * `subject` is the account's stable IAM id — the `id` on the created row, and
 * the same value that arrives later as the OIDC `sub` (iam
 * `internal/oidc/token.go`, `subjectOf`). It is the one name for this person
 * that every other surface will also know them by, so it is the join between a
 * visit and the account that visit produced.
 *
 * It widens {@link LoginResponse} rather than adding a field to it, because only
 * this path can fill it: `/v1/iam/login` answers with an authorization code, not
 * a user row, so a plain sign-in has no subject to report and should not carry a
 * field that is always absent.
 *
 * Optional because it is READ from the answer, not assumed: a response without a
 * usable id still created the account, and the caller is entitled to know that
 * much without being handed an empty string that reads like a name.
 */
export interface SignupResponse extends LoginResponse {
  readonly subject?: string
}

export interface SignupRequest {
  readonly email: string
  readonly password: string
  readonly clientId: string
  readonly application: string
  /**
   * The org to create the user in. REQUIRED — unlike login's optional
   * lookup hint, you cannot create a user in "no org", and IAM gates this
   * against the application's own org.
   */
  readonly organization: string
  /**
   * The downstream OIDC request, when an app sent the user here to register.
   * Registration completes by signing the new user in, so these are forwarded
   * to that sign-in: without them the minted code carries no PKCE binding and
   * there is nowhere to return the user to.
   */
  readonly redirectUri?: string
  readonly state?: string
  readonly codeChallenge?: string
  readonly codeChallengeMethod?: 'S256' | 'plain'
  readonly nonce?: string
}

/**
 * Ask IAM to send a one-time code — the ONE send, shared by account recovery and
 * by code sign-in, because it is one endpoint minting one record.
 */
export interface CodeRequest {
  /** Where the code goes: the account's own email address or phone number. */
  readonly dest: string
  /** Which of the two `dest` is. The screen knows; IAM validates. */
  readonly channel: 'email' | 'phone'
  /**
   * The application the code is minted under, `owner/name` — {@link AppLogin.id},
   * so it is read from the descriptor rather than assembled from a guessed owner.
   */
  readonly application: string
}

/**
 * Set a new password, with the proof that you may.
 *
 * Two proofs, and the union is what makes a request carrying neither or both
 * unrepresentable — the same exclusivity IAM enforces at the endpoint, expressed
 * here so it cannot be got wrong on the way there.
 *
 * `code` is the one {@link AuthClient.sendCode} delivered, so `identifier` must be
 * the SAME address it was sent to: IAM redeems a code against the address it was
 * minted for. `oldPassword` needs no identifier at all — IAM takes the subject from
 * the session the call carries, never from the body.
 */
export type SetPasswordRequest = { readonly password: string } & (
  | { readonly code: string; readonly identifier: string; readonly organization: string }
  | { readonly oldPassword: string }
)

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
 * What one IAM application offers a login screen, read live from
 * `/v1/iam/get-app-login`. Every arm the screen draws is derived from a field
 * here, so what is offered and what the server will complete cannot drift: IAM
 * masks each switch with the capability behind it before answering (an
 * `enableCodeSignin` it cannot deliver comes back false — `loginView`,
 * internal/oidc/frontdoor.go).
 *
 * The one thing it does NOT describe is wallet sign-in, which is a capability of
 * the IAM BINARY rather than of an application's config — see
 * {@link offeredWalletChains}.
 */
export interface AppLogin {
  /** IAM application name (e.g. `hanzo-id`). */
  readonly application: string
  /** The application's own id, `owner/name` — what an OTP is minted under. */
  readonly id: string
  /** Owning organization slug. */
  readonly organization: string
  /** Email/username + password sign-in is enabled. */
  readonly enablePassword: boolean
  /** Self-service signup is enabled. */
  readonly enableSignUp: boolean
  /** Email/SMS code sign-in is enabled AND a code can be delivered. */
  readonly enableCodeSignin: boolean
  /** Social providers enabled on the app, in display order. */
  readonly providers: readonly AppProvider[]
}
