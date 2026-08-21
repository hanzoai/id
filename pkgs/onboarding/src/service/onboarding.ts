/**
 * Onboarding service — the IAM-backed implementation of the org/project/
 * wallet flow.
 *
 * One way: every write goes through the canonical IAM REST surface under
 * `/v1/iam/*` (the same IAM paths the auth client uses). There is no separate
 * onboarding backend — the org and project records live in IAM, which is the
 * identity registry.
 *
 *   listOrgs()    GET  /v1/iam/get-account + GET /v1/iam/memberships
 *   createOrg()   POST /v1/iam/onboard             (the self-service front door)
 *   createProject POST /v1/iam/projects
 *
 * The org list is the MEMBERSHIP relation, not the org registry. IAM's
 * `/v1/iam/organizations` is the registry and its Guard admits only a
 * SuperAdmin to a listing (a plain bearer earns 403 — the org rows are filed
 * under the reserved `admin` owner, and a read there is authorized by
 * `memberOf(name)`, which a nameless list can never satisfy). The set an
 * ordinary person may land in is `(User x Org x Role)`, so that is what this
 * reads: `/v1/iam/memberships?user=<owner>/<name>`, whose target rides in the
 * query and which the handler owner-scopes itself.
 *
 * Wallet linking is NOT here. A wallet binds to an identity by PROVING the key
 * (CAIP-122: mint a challenge, sign it, verify it), so it is the auth package's
 * flow — `loginWithWalletChain` against `/v1/iam/web3/{nonce,verify}`, which
 * links to the live session when one exists. It was never expressible as a
 * record write: the field it used to set (`web3onboard`) is not on the user at
 * all, and one address per user cannot represent N wallets across M chains.
 *
 * Founding an org goes through `onboard`, NOT the `add-organization` admin verb.
 * They are different doors: add-organization is entity CRUD behind IAM's
 * authenticated Guard, filed under owner "admin", and a human may only write an
 * org row named after the org they are already in — so a person founding their
 * FIRST org is refused there by construction (403), and with no bearer at all the
 * Guard refuses before that (401). `onboard` is the door built for this: it
 * resolves the caller from their own session or bearer and provisions the whole
 * org — org stamped with them as Founder, them moved in as its owner, one
 * metered API key — under their own authority as its founder.
 *
 * Both credentials are offered on every call: `credentials: 'include'` for the
 * portal session cookie (a bare portal sign-in mints NO bearer, which is why the
 * bearer-only door 401'd), and `Authorization` when the host does hold a token.
 * IAM resolves session first, then bearer.
 */
import type { Project } from '@hanzo/iam'
import type { OrgRef, ProjectRef } from '../domain/types'

/** Result of a write that can fail gracefully (no throw on expected errors). */
export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

export interface OnboardingService {
  /**
   * The organizations the signed-in user may land in: their home org, plus
   * every org they hold a membership in. Returns [] (not an error) when they
   * have none or when either read fails — onboarding's next move is to create
   * one, and a failed list must not stand in the way of that.
   */
  listOrgs(): Promise<OrgRef[]>
  /** Create a new organization owned by the user. */
  createOrg(input: { name: string; displayName: string }): Promise<Result<OrgRef>>
  /** Create a project inside `organization`. */
  createProject(input: { organization: string; name: string; displayName: string }): Promise<Result<ProjectRef>>
}

export interface OnboardingServiceOptions {
  /** IAM origin, no trailing slash (the org's `iamUrl`, i.e. hanzo.id). */
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
    const account = await getAccount()
    if (!account) return []
    // The home org comes back on the account read itself, so it costs nothing
    // and it is the one org that may have NO membership row — authz treats the
    // account's own owner as belonging by construction (memberOf is true for
    // p.Org before it consults the membership set). Seeding it first also makes
    // it the head of the list, which is where onboarding wants to land.
    const orgs = new Map<string, OrgRef>()
    if (account.home) orgs.set(account.home.name, account.home)
    for (const row of await memberships(account)) {
      const name = typeof row.org === 'string' ? row.org : ''
      if (name && !orgs.has(name)) orgs.set(name, { name, displayName: name })
    }
    return [...orgs.values()]
  }

  /**
   * The membership rows for one identity. This route answers in IAM's
   * `{status, data, data2}` envelope — that is its live contract, not leftover
   * compat: `httpx.Good(rows, len(rows))` puts the ROWS in `data` and the COUNT
   * in `data2`. Read `data` only; treating `data2` as a row source would decode
   * a number as a list.
   */
  async function memberships(account: Account): Promise<Record<string, unknown>[]> {
    const url = new URL('/v1/iam/memberships', base)
    url.searchParams.set('user', `${account.owner}/${account.name}`)
    try {
      const res = await f(url.toString(), { headers: await authHeaders(false), credentials: 'include' })
      if (!res.ok) return []
      const body = (await res.json()) as Record<string, unknown>
      const rows = Array.isArray(body.data) ? body.data : []
      return rows.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    } catch {
      return []
    }
  }

  /**
   * Found the caller's own organization through the self-service front door.
   *
   * The server owns the slug: it derives it from the display name under the ONE
   * policy every surface shares, so the returned `org` is authoritative and the
   * client's slug preview is only a preview. It answers `{org}` on success and
   * `{error}` with a 4xx/5xx on failure, so read it directly.
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
      if (!res.ok) return { ok: false, error: await reasonOf(res) }
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
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
    const url = new URL('/v1/iam/projects', base)
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

  /**
   * The signed-in user from `/v1/iam/get-account`: who they are, and the org
   * they live in. The account envelope carries the user in `data` and that home
   * organization in `data2` — both are named slots on this route's own
   * response, so reading them is the contract and not a compat fallback.
   */
  async function getAccount(): Promise<Account | null> {
    const url = new URL('/v1/iam/get-account', base)
    try {
      const res = await f(url.toString(), { headers: await authHeaders(false), credentials: 'include' })
      if (!res.ok) return null
      const body = (await res.json()) as Record<string, unknown>
      const data = (body.data ?? body) as Record<string, unknown>
      const owner = typeof data.owner === 'string' ? data.owner : ''
      const name = typeof data.name === 'string' ? data.name : ''
      if (!owner || !name) return null
      const home = typeof body.data2 === 'object' && body.data2 !== null
        ? toOrgRef(body.data2 as Record<string, unknown>)
        : null
      return { owner, name, home: home ?? { name: owner, displayName: owner } }
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
      // A native entity route answers with the RECORD, not a status envelope —
      // there is no `status:"error"` to branch on, so the HTTP code is the whole
      // signal and the body carries only the reason.
      if (!res.ok) return { ok: false, error: await reasonOf(res) }
      return { ok: true, value: onOk() }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  }

  return { listOrgs, createOrg, createProject }
}

/** The signed-in identity plus the org it lives in. */
interface Account {
  readonly owner: string
  readonly name: string
  readonly home: OrgRef | null
}

/**
 * Why a request failed, in the caller's words. The front door answers `{error}`
 * and a typed entity route answers zip's `{status:<code>, error}` — one named
 * slot either way — so this reads that slot and falls back to the bare code.
 */
async function reasonOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return typeof body.error === 'string' && body.error ? body.error : `HTTP ${res.status}`
}

function toOrgRef(row: Record<string, unknown>): OrgRef | null {
  const name = typeof row.name === 'string' ? row.name : ''
  if (!name) return null
  const displayName = typeof row.displayName === 'string' && row.displayName ? row.displayName : name
  return { name, displayName }
}

