import type { OrgConfig } from '@hanzo/id-shared'

/**
 * The signed-in person's own account, as IAM will let them read and change it.
 *
 * Separate from {@link createAuthClient}, which is about OBTAINING a session —
 * login, signup, device, the OAuth legs. This is about an identity you already
 * hold. Same transport, same org, same envelope; a different question.
 *
 * Everything here is SELF-SCOPED BY CONSTRUCTION: not one call names a target
 * user. IAM takes the subject from the session cookie the request carries
 * (`callerOf` on the public doors, the Guard principal on the authed ones), so
 * there is no field a caller could set to reach somebody else's row. That is
 * also why the entity verbs are absent — `update-user` is admin CRUD and
 * answers a regular user 403 on their OWN record, deliberately, so that a
 * self-write cannot carry `isAdmin` or `organization`. The doors below are the
 * ones IAM built for a person editing themselves.
 */

/** IAM's masked user row — the fields an account screen has any use for. */
export interface Account {
  readonly owner: string
  readonly name: string
  readonly id: string
  readonly displayName: string
  readonly email: string
  readonly emailVerified: boolean
  readonly phone: string
  readonly countryCode: string
  readonly avatar: string
  readonly bio: string
  readonly location: string
  readonly homepage: string
  readonly createdTime: string
  readonly isAdmin: boolean
  readonly preferredMfaType: string
  readonly signupApplication: string
}

/** One organization the caller belongs to, and how. */
export interface Membership {
  readonly org: string
  readonly role: string
}

/** A federated identity attached to this account. */
export interface LinkedAccount {
  readonly provider: string
  readonly subject: string
}

/** A registered passkey. */
export interface Passkey {
  readonly name: string
  readonly createdTime: string
  readonly attachment: string
  readonly transport: readonly string[]
}

/** What the account's application offers, so a screen renders only real doors. */
export interface AuthMethods {
  readonly password: boolean
  readonly webauthn: boolean
  readonly oauth: readonly { readonly name: string; readonly type: string }[]
}

/** The two answers IAM records about using this account's data. */
export interface Consent {
  readonly insights: boolean | null
  readonly training: boolean | null
}

export interface AccountClient {
  /** The caller's full masked row, or null when nobody is signed in. */
  read(): Promise<Account | null>
  /** Every org the caller belongs to, home org first. */
  memberships(user: string): Promise<Membership[]>
  /** Federated identities attached to this account. */
  linked(): Promise<LinkedAccount[]>
  /** Begin attaching another provider; returns the URL to follow. */
  link(provider: string, returnUri: string): Promise<string>
  /** Detach a provider from this account. */
  unlink(providerType: string): Promise<void>
  /** What the application offers (password, passkey, which providers). */
  methods(): Promise<AuthMethods>
  /** This account's passkeys. */
  passkeys(): Promise<Passkey[]>
  /** Register a passkey on this device. */
  addPasskey(): Promise<void>
  /** Remove a registered passkey by its `name`. */
  removePasskey(name: string): Promise<void>
  /** Read the data-sharing answers. */
  consent(): Promise<Consent>
  /** Record a data-sharing answer. Absent fields are left untouched. */
  saveConsent(patch: Partial<Record<keyof Consent, boolean>>): Promise<void>
}

export interface AccountClientOptions {
  readonly org: OrgConfig
  /**
   * A bearer for the doors behind IAM's Guard, which authenticates on the token
   * and NOT on the session cookie ("bearer required, principal attached",
   * internal/authz/authz.go). `/v1/iam/account`, `/linked-accounts`,
   * `/auth/methods`, `/consent` and `/preferences` are self-authenticating public
   * doors and need none; `/memberships` and `/webauthn-credentials` are behind
   * the Guard and answer a cookie-only caller 401.
   *
   * Optional, and its absence is not an error — a portal sign-in mints only the
   * cookie, so the surface must still read everything it can rather than fail
   * whole. Resolves null when no token can be had.
   */
  readonly getToken?: () => Promise<string | null>
  /** Override fetch impl (testing). Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch
}

/**
 * IAM answers a refusal with HTTP 200 and `{status:'error', msg}` as readily as
 * with a 4xx, so every read here consults the envelope before the status code —
 * the same invariant `parseLoginResponse` states for the auth client. `msg` is
 * the only sentence a screen can honestly show.
 */
function fault(body: Record<string, unknown>, res: Response): string | null {
  const msg = typeof body.msg === 'string' && body.msg ? body.msg : null
  if (body.status === 'error') return msg ?? `HTTP ${res.status}`
  if (!res.ok) return msg ?? `HTTP ${res.status}`
  return null
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const bool = (v: unknown): boolean => v === true

/**
 * Shape the `data` of a `/v1/iam/account` envelope into an {@link Account}.
 *
 * null when the payload names no principal. Module-level and exported because
 * the auth client reads the same address for the same person: one field list,
 * so the two cannot come to disagree about what an account IS.
 */
export function accountOf(data: unknown): Account | null {
  const d = (typeof data === 'object' && data ? data : {}) as Record<string, unknown>
  if (!str(d.owner) || !str(d.name)) return null
  return {
    owner: str(d.owner),
    name: str(d.name),
    id: str(d.id),
    displayName: str(d.displayName),
    email: str(d.email),
    emailVerified: bool(d.emailVerified),
    phone: str(d.phone),
    countryCode: str(d.countryCode),
    avatar: str(d.avatar),
    bio: str(d.bio),
    location: str(d.location),
    homepage: str(d.homepage),
    createdTime: str(d.createdTime),
    isAdmin: bool(d.isAdmin),
    preferredMfaType: str(d.preferredMfaType),
    signupApplication: str(d.signupApplication),
  }
}

export function createAccountClient(opts: AccountClientOptions): AccountClient {
  const org = opts.org
  const f = opts.fetchImpl ?? fetch

  /** Every call is first-party to the brand's own `*.id` host, so the session
   *  cookie rides along and no token has to be minted to read your own name. */
  const at = (path: string) => new URL(path, org.iamUrl).toString()

  /** The cookie always rides; the bearer joins it when one can be had. */
  async function headers(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    const h: Record<string, string> = { Accept: 'application/json', ...extra }
    const token = await opts.getToken?.().catch(() => null)
    if (token) h.Authorization = `Bearer ${token}`
    return h
  }

  /**
   * The two doors behind the Guard. It reads a bearer and nothing else, so a
   * caller holding only the session cookie gets a bare 401 — which on screen is
   * the word "unauthorized" shown to somebody who is plainly signed in. Say what
   * is actually true instead, once, where both callers pass.
   */
  async function guarded(path: string): Promise<Record<string, unknown>> {
    if (!(await opts.getToken?.().catch(() => null))) {
      throw new Error('Sign in again to manage this — it needs a fresh token, not just this browser session.')
    }
    return get(path)
  }

  async function get(path: string): Promise<Record<string, unknown>> {
    const res = await f(at(path), { headers: await headers(), credentials: 'include' })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    const bad = fault(body, res)
    if (bad) throw new Error(bad)
    return body
  }

  async function send(path: string, method: 'POST' | 'PUT', payload: unknown): Promise<Record<string, unknown>> {
    const res = await f(at(path), {
      method,
      headers: await headers({ 'Content-Type': 'application/json' }),
      credentials: 'include',
      body: JSON.stringify(payload),
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    const bad = fault(body, res)
    if (bad) throw new Error(bad)
    return body
  }

  async function read(): Promise<Account | null> {
    let body: Record<string, unknown>
    try {
      body = await get('/v1/iam/account')
    } catch {
      // "please sign in first" is the anonymous answer, not a failure worth
      // showing — the caller renders the signed-out door instead.
      return null
    }
    return accountOf(body.data)
  }

  /**
   * `?user=<homeOrg>/<username>` is the caller's own key. The read is org-scoped
   * — it requires the target's home org to equal yours — which is exactly true
   * of asking about yourself, and false of asking about anyone else.
   */
  async function memberships(user: string): Promise<Membership[]> {
    const body = await guarded(`/v1/iam/memberships?user=${encodeURIComponent(user)}`)
    const rows = Array.isArray(body.data) ? body.data : []
    return rows
      .map((r) => (typeof r === 'object' && r ? (r as Record<string, unknown>) : {}))
      .filter((r) => str(r.org))
      .map((r) => ({ org: str(r.org), role: str(r.role) || 'member' }))
  }

  async function linked(): Promise<LinkedAccount[]> {
    const body = await get('/v1/iam/linked-accounts')
    const rows = Array.isArray(body.data) ? body.data : []
    return rows
      .map((r) => (typeof r === 'object' && r ? (r as Record<string, unknown>) : {}))
      .filter((r) => str(r.provider) && str(r.subject))
      .map((r) => ({ provider: str(r.provider), subject: str(r.subject) }))
  }

  /**
   * Attaching is a POST, never a link a page can be lured into following: IAM
   * runs the same federation transaction as a sign-in and carries the caller's
   * subject so the callback ATTACHES instead of resolving, which is an account
   * takeover if a third-party page can trigger it.
   */
  async function link(provider: string, returnUri: string): Promise<string> {
    const body = await send('/v1/iam/link', 'POST', { provider, clientId: org.clientId, returnUri })
    const d = (typeof body.data === 'object' && body.data ? body.data : {}) as Record<string, unknown>
    const url = str(body.data) || str(d.url) || str(d.redirectUrl)
    if (!url) throw new Error('IAM returned no address to continue at')
    return url
  }

  async function unlink(providerType: string): Promise<void> {
    await send('/v1/iam/unlink', 'POST', { providerType })
  }

  async function methods(): Promise<AuthMethods> {
    const body = await get(`/v1/iam/auth/methods?clientId=${encodeURIComponent(org.clientId)}`)
    const d = (typeof body.data === 'object' && body.data ? body.data : body) as Record<string, unknown>
    const oauth = Array.isArray(d.oauth) ? d.oauth : []
    return {
      password: bool(d.password),
      webauthn: bool(d.webauthn),
      oauth: oauth
        .map((r) => (typeof r === 'object' && r ? (r as Record<string, unknown>) : {}))
        .filter((r) => str(r.type))
        .map((r) => ({ name: str(r.name) || str(r.type), type: str(r.type) })),
    }
  }

  /**
   * IAM scopes this list to the ORG, not to the person, so it can answer with
   * passkeys that are not yours. `user` on each row is `owner/name`; keeping
   * only your own is the difference between an account screen and a directory.
   */
  async function passkeys(): Promise<Passkey[]> {
    const me = await read()
    if (!me) return []
    const mine = `${me.owner}/${me.name}`
    const body = await guarded('/v1/iam/webauthn-credentials')
    const d = (typeof body.data === 'object' && body.data ? body.data : body) as Record<string, unknown>
    const rows = Array.isArray(d.webauthnCredentials) ? d.webauthnCredentials : []
    return rows
      .map((r) => (typeof r === 'object' && r ? (r as Record<string, unknown>) : {}))
      .filter((r) => str(r.user) === mine)
      .map((r) => ({
        name: str(r.name),
        createdTime: str(r.createdTime),
        attachment: str(r.attachment),
        transport: Array.isArray(r.transport) ? r.transport.filter((t): t is string => typeof t === 'string') : [],
      }))
  }

  async function addPasskey(): Promise<void> {
    if (!('credentials' in navigator) || typeof PublicKeyCredential === 'undefined') {
      throw new Error('This browser has no passkey support')
    }
    const begun = await get('/v1/iam/webauthn/signup/begin')
    const options = (begun.publicKey ?? (begun as { publicKey?: unknown }).publicKey ?? begun) as Record<string, unknown>
    const pk = (typeof options.publicKey === 'object' && options.publicKey ? options.publicKey : options) as PublicKeyCredentialCreationOptions
    const created = await navigator.credentials.create({ publicKey: revive(pk) })
    if (!created) throw new Error('No passkey was created')
    await send('/v1/iam/webauthn/signup/finish', 'POST', encode(created as PublicKeyCredential))
  }

  async function removePasskey(name: string): Promise<void> {
    const me = await read()
    if (!me) throw new Error('Sign in again to change your passkeys')
    await send('/v1/iam/webauthn-credentials/delete', 'POST', { owner: me.owner, name })
  }

  async function consent(): Promise<Consent> {
    const body = await get('/v1/iam/consent')
    const d = (typeof body.data === 'object' && body.data ? body.data : body) as Record<string, unknown>
    const tri = (v: unknown): boolean | null => (v === 'granted' ? true : v === 'refused' ? false : null)
    return {
      insights: typeof d.insights === 'boolean' ? d.insights : tri(d.insights),
      training: tri(d.training),
    }
  }

  /** Absent means untouched, so answering one question cannot revoke the other. */
  async function saveConsent(patch: Partial<Record<keyof Consent, boolean>>): Promise<void> {
    const body: Record<string, unknown> = {}
    if (patch.insights !== undefined) body.insights = patch.insights
    if (patch.training !== undefined) body.training = patch.training ? 'granted' : 'refused'
    await send('/v1/iam/consent', 'PUT', body)
  }


  return {
    read,
    memberships,
    linked,
    link,
    unlink,
    methods,
    passkeys,
    addPasskey,
    removePasskey,
    consent,
    saveConsent,
  }
}

/** base64url → the ArrayBuffers WebAuthn requires, JSON having no bytes. */
function bytes(v: unknown): ArrayBuffer {
  const s = String(v ?? '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const raw = atob(s.padEnd(Math.ceil(s.length / 4) * 4, '='))
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out.buffer
}

/** The reverse, for the fields the finish call sends back. */
function b64(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < b.length; i += 1) s += String.fromCharCode(b[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function revive(pk: PublicKeyCredentialCreationOptions): PublicKeyCredentialCreationOptions {
  const raw = pk as unknown as Record<string, unknown>
  const user = (raw.user ?? {}) as Record<string, unknown>
  const exclude = Array.isArray(raw.excludeCredentials) ? raw.excludeCredentials : []
  return {
    ...pk,
    challenge: bytes(raw.challenge),
    user: { ...(user as unknown as PublicKeyCredentialUserEntity), id: new Uint8Array(bytes(user.id)) },
    excludeCredentials: exclude.map((c) => {
      const e = c as Record<string, unknown>
      return { ...(e as unknown as PublicKeyCredentialDescriptor), id: bytes(e.id) }
    }),
  }
}

function encode(c: PublicKeyCredential): Record<string, unknown> {
  const r = c.response as AuthenticatorAttestationResponse
  return {
    id: c.id,
    rawId: b64(c.rawId),
    type: c.type,
    response: { clientDataJSON: b64(r.clientDataJSON), attestationObject: b64(r.attestationObject) },
  }
}
