/**
 * Onboarding service — the IAM-backed implementation of the org/project/
 * wallet flow.
 *
 * One way: every write goes through the canonical IAM REST surface under
 * `/v1/iam/*` (the same IAM paths the auth client uses). There is no separate
 * onboarding backend — the org and project records live in IAM, which is the
 * identity registry.
 *
 *   listOrgs()    GET  /v1/iam/get-organizations   (user-scoped server-side)
 *   createOrg()   POST /v1/iam/onboard             (the self-service front door)
 *   createProject POST /v1/iam/add-project
 *   linkWallet()  client-side wallet connect → IAM update-user (host-driven)
 *   getConsent()  GET  /v1/iam/consent              (self-scoped)
 *   setConsent()  PUT  /v1/iam/consent              (self-scoped, audited)
 *
 * Founding an org goes through `onboard`, NOT the `add-organization` admin verb.
 * They are different doors: add-organization is entity CRUD behind IAM's
 * authenticated Guard, filed under owner "admin", and a human may only write an
 * org row named after the org they are already in — so a person founding their
 * FIRST org is refused there by construction (403), and with no bearer at all the
 * Guard refuses before that (401). `onboard` is the door built for this: it
 * resolves the caller from their own session or bearer and provisions the whole
 * tenant — org stamped with them as Founder, them moved in as its owner, one
 * metered API key — under their own authority as its founder.
 *
 * Both credentials are offered on every call: `credentials: 'include'` for the
 * portal session cookie (a bare portal sign-in mints NO bearer, which is why the
 * bearer-only door 401'd), and `Authorization` when the host does hold a token.
 * IAM resolves session first, then bearer.
 */
import type { Project } from '@hanzo/iam'
import type { ConsentAnswer, ConsentRecord, OrgRef, ProjectRef } from '../domain/types'

/**
 * IAM's defaults for a person who has never answered, mirrored from
 * `schema.ConsentOf`. Every read failure resolves here, and `training` is
 * UNANSWERED — so a missing, truncated or unrecognized record yields a state that
 * means "still ask" rather than one that means yes.
 */
const CONSENT_DEFAULT: ConsentRecord = { insights: true, training: '' }

/** Result of a write that can fail gracefully (no throw on expected errors). */
export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

export interface OnboardingService {
  /**
   * List organizations the signed-in user can land in. IAM scopes
   * `get-organizations` to the caller's memberships server-side from the
   * bearer token. Returns [] (not an error) when the user belongs to none.
   */
  listOrgs(): Promise<OrgRef[]>
  /** Create a new organization owned by the user. */
  createOrg(input: { name: string; displayName: string }): Promise<Result<OrgRef>>
  /** Create a project inside `organization`. */
  createProject(input: { organization: string; name: string; displayName: string }): Promise<Result<ProjectRef>>
  /**
   * Attach a wallet address to the signed-in user (IAM `update-user`,
   * `web3Onboard` address field). The actual wallet connect happens in the
   * browser via the host-supplied `connectWallet`; this only persists the
   * resulting address.
   */
  linkWallet(address: string): Promise<Result<string>>
  /**
   * Read the caller's own consent record. Somebody who has never answered gets
   * IAM's defaults — insights on, training UNANSWERED — so the screen always has
   * something to show and knows it still has to ask.
   */
  getConsent(): Promise<ConsentRecord>
  /**
   * Record the caller's own consent answer.
   *
   * Fields are OPTIONAL because absent means UNTOUCHED on the wire: a screen that
   * saves only the switch it changed must not answer the other question by
   * omission. Passing `insights: false` alongside a training answer would revoke a
   * choice the person never made.
   */
  setConsent(patch: { insights?: boolean; training?: ConsentAnswer }): Promise<Result<ConsentRecord>>
}

export interface OnboardingServiceOptions {
  /** IAM origin, no trailing slash (the tenant's `iamUrl`, i.e. hanzo.id). */
  readonly iamUrl: string
  /** Owning org slug used as the default `owner` for new records. */
  readonly orgId: string
  /** Bearer-token provider; resolves null when no session is present. */
  readonly getAccessToken: () => Promise<string | null> | string | null
  /** Override fetch (testing). Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch
}

const trimSlash = (s: string): string => s.replace(/\/+$/, '')

export function createOnboardingService(opts: OnboardingServiceOptions): OnboardingService {
  const base = trimSlash(opts.iamUrl)
  const f = opts.fetchImpl ?? fetch

  async function authHeaders(json = true): Promise<HeadersInit> {
    const token = await opts.getAccessToken()
    const h: Record<string, string> = { Accept: 'application/json' }
    if (json) h['Content-Type'] = 'application/json'
    if (token) h.Authorization = `Bearer ${token}`
    return h
  }

  async function listOrgs(): Promise<OrgRef[]> {
    const url = new URL('/v1/iam/get-organizations', base)
    let body: Record<string, unknown>
    try {
      const res = await f(url.toString(), { headers: await authHeaders(false), credentials: 'include' })
      if (!res.ok) return []
      body = (await res.json()) as Record<string, unknown>
    } catch {
      return []
    }
    const rows = extractRows(body)
    return rows.map(toOrgRef).filter((o): o is OrgRef => o !== null)
  }

  /**
   * Found the caller's own organization through the self-service front door.
   *
   * The server owns the slug: it derives it from the display name under the ONE
   * policy every surface shares, so the returned `org` is authoritative and the
   * client's slug preview is only a preview. It answers `{org}` on success and
   * `{error}` with a 4xx/5xx on failure — not the casibase `{status,msg}`
   * envelope the entity CRUD returns — so read it directly.
   */
  async function createOrg(input: { name: string; displayName: string }): Promise<Result<OrgRef>> {
    const url = new URL('/v1/iam/onboard', base)
    const displayName = input.displayName || input.name
    try {
      const res = await f(url.toString(), {
        method: 'POST',
        headers: await authHeaders(),
        credentials: 'include',
        body: JSON.stringify({ name: displayName }),
      })
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        const msg = typeof body.error === 'string' && body.error ? body.error : `HTTP ${res.status}`
        return { ok: false, error: msg }
      }
      const org = typeof body.org === 'string' ? body.org : ''
      if (!org) return { ok: false, error: 'request failed' }
      return { ok: true, value: { name: org, displayName } }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  }

  async function createProject(input: {
    organization: string
    name: string
    displayName: string
  }): Promise<Result<ProjectRef>> {
    const url = new URL('/v1/iam/add-project', base)
    const project: Partial<Project> = {
      owner: input.organization,
      name: input.name,
      displayName: input.displayName,
      organization: input.organization,
      isDefault: false,
    }
    return writeRecord(url, project, () => ({
      owner: input.organization,
      name: input.name,
      displayName: input.displayName,
      organization: input.organization,
    }))
  }

  async function linkWallet(address: string): Promise<Result<string>> {
    const trimmed = address.trim()
    if (!isHexAddress(trimmed)) return { ok: false, error: 'invalid wallet address' }
    // Resolve the signed-in user (owner/name) from the session — IAM's
    // update-user is keyed by `id=<owner>/<name>`, not a "self" alias.
    const account = await getAccount()
    if (!account) return { ok: false, error: 'not signed in' }
    const url = new URL('/v1/iam/update-user', base)
    url.searchParams.set('id', `${account.owner}/${account.name}`)
    // Scope the write to the single `web3onboard` column so the rest of the
    // user row is untouched (IAM replaces unscoped writes wholesale).
    url.searchParams.set('columns', 'web3onboard')
    try {
      const res = await f(url.toString(), {
        method: 'POST',
        headers: await authHeaders(),
        credentials: 'include',
        // IAM's User JSON tag is lowercase `web3onboard`; send the full
        // owner/name so the row identity is unambiguous on the server.
        body: JSON.stringify({ owner: account.owner, name: account.name, web3onboard: trimmed }),
      })
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (body.status === 'error') return { ok: false, error: msgOf(body) }
      return { ok: true, value: trimmed }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  }

  /**
   * Consent goes through `/v1/iam/consent`, NOT `update-user` and NOT
   * `update-preferences`. IAM refuses a consent key on the generic preferences
   * patch on purpose — "consent is not a preference; use PUT /v1/iam/consent to
   * answer" — because the answer is validated against a closed set and every
   * change is audited on the same transaction as the write. A second writer of the
   * one record that most needs a single one would be unvalidated and unaudited.
   *
   * It is also the endpoint that WORKS. Answering through `update-user` needs the
   * legacy compat write verb, whose authz noun is `users` — an admin-scoped entity
   * write — so a person recording their own consent is refused with a 403. This
   * endpoint is self-scoped: the target is always the caller, resolved from the
   * session or bearer, never a subject named in the body. Consent someone else can
   * set on your behalf is not consent.
   */
  function consentUrl(): URL {
    return new URL('/v1/iam/consent', base)
  }

  async function getConsent(): Promise<ConsentRecord> {
    try {
      const res = await f(consentUrl().toString(), {
        headers: await authHeaders(false),
        credentials: 'include',
      })
      if (!res.ok) return CONSENT_DEFAULT
      const body = (await res.json()) as Record<string, unknown>
      return toConsent(body)
    } catch {
      return CONSENT_DEFAULT
    }
  }

  async function setConsent(patch: {
    insights?: boolean
    training?: ConsentAnswer
  }): Promise<Result<ConsentRecord>> {
    // Send ONLY what was asked. Every field IAM accepts is a pointer so that
    // "absent" and "set to the zero value" are different requests; spelling out an
    // untouched field here would answer a question the person did not answer.
    const body: Record<string, unknown> = {}
    if (patch.insights !== undefined) body.insights = patch.insights
    if (patch.training !== undefined) body.training = patch.training
    if (Object.keys(body).length === 0) return { ok: false, error: 'nothing to record' }
    try {
      const res = await f(consentUrl().toString(), {
        method: 'PUT',
        headers: await authHeaders(),
        credentials: 'include',
        body: JSON.stringify(body),
      })
      const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        const msg = typeof parsed.msg === 'string' && parsed.msg ? parsed.msg : `HTTP ${res.status}`
        return { ok: false, error: msg }
      }
      if (parsed.status === 'error') return { ok: false, error: msgOf(parsed) }
      return { ok: true, value: toConsent(parsed) }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  }

  /** Read the signed-in user's `{owner, name}` from `/v1/iam/get-account`. */
  async function getAccount(): Promise<{ owner: string; name: string } | null> {
    const url = new URL('/v1/iam/get-account', base)
    try {
      const res = await f(url.toString(), { headers: await authHeaders(false), credentials: 'include' })
      if (!res.ok) return null
      const body = (await res.json()) as Record<string, unknown>
      const data = (body.data ?? body) as Record<string, unknown>
      const owner = typeof data.owner === 'string' ? data.owner : ''
      const name = typeof data.name === 'string' ? data.name : ''
      if (!owner || !name) return null
      return { owner, name }
    } catch {
      return null
    }
  }

  async function writeRecord<T>(
    url: URL,
    payload: unknown,
    onOk: () => T,
  ): Promise<Result<T>> {
    try {
      const res = await f(url.toString(), {
        method: 'POST',
        headers: await authHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (body.status === 'error') return { ok: false, error: msgOf(body) }
      return { ok: true, value: onOk() }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  }

  return { listOrgs, createOrg, createProject, linkWallet, getConsent, setConsent }
}

/** Rows of an IAM list response: the named `data` slot, falling back to the legacy `data2` slot until IAM stops emitting it. */
function extractRows(body: Record<string, unknown>): Record<string, unknown>[] {
  const candidate = Array.isArray(body.data) ? body.data : Array.isArray(body.data2) ? body.data2 : []
  return candidate.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
}

function toOrgRef(row: Record<string, unknown>): OrgRef | null {
  const name = typeof row.name === 'string' ? row.name : ''
  if (!name) return null
  const displayName = typeof row.displayName === 'string' && row.displayName ? row.displayName : name
  return { name, displayName }
}

function msgOf(body: Record<string, unknown>): string {
  return typeof body.msg === 'string' && body.msg ? body.msg : 'request failed'
}

/**
 * Decode a consent record out of an IAM response, tolerating the `{status,data}`
 * envelope and a bare object alike.
 *
 * An unrecognized `training` token degrades to UNANSWERED rather than being kept:
 * a spelling this version does not know is not a grant, and coercing it would let
 * a corrupt record read as permission. Same reasoning as IAM's own decode — there
 * is no path through here that invents a grant.
 */
function toConsent(body: Record<string, unknown>): ConsentRecord {
  const data = (body.data ?? body) as Record<string, unknown>
  const insights = typeof data.insights === 'boolean' ? data.insights : CONSENT_DEFAULT.insights
  const raw = typeof data.training === 'string' ? data.training : ''
  const training: ConsentAnswer = raw === 'granted' || raw === 'refused' ? raw : ''
  return { insights, training }
}

/** EIP-55-agnostic 0x-prefixed 20-byte address check. */
function isHexAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s)
}
