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
import {
  PROP_COMPLETED,
  PROP_CONSENT,
  PROP_PLAN,
  type OrgRef,
  type PlanInfo,
  type ProjectRef,
} from '../domain/types'

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
   * Read the persisted onboarding record from the signed-in user's
   * `properties`. All-null when the user has never completed onboarding —
   * which is the ONLY case the host should mount the flow for.
   */
  readOnboarding(): Promise<{ completedAt: string | null; consent: boolean | null; plan: string | null }>
  /**
   * Persist onboarding fields onto the user record, read-merge-write. THIS is
   * what stops the flow repeating: completion lives on the USER, not in any
   * browser storage, so a new device, a cleared cache and a re-login all see
   * it done.
   */
  saveOnboarding(patch: { completedAt?: string; consent?: boolean; plan?: string }): Promise<Result<true>>
  /**
   * List purchasable plans from the billing catalog on the PAY origin. The
   * catalog is the only price authority — this pkg renders what it serves and
   * states no price of its own. Returns [] on any failure; the plan step then
   * offers the two choices without a price grid.
   */
  listPlans(payUrl: string): Promise<PlanInfo[]>
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
    const res = await updateSelf((row) => {
      row.web3onboard = trimmed
    })
    return res.ok ? { ok: true, value: trimmed } : res
  }

  async function readOnboarding(): Promise<{
    completedAt: string | null
    consent: boolean | null
    plan: string | null
  }> {
    const row = await getAccount()
    const props = (row?.properties ?? {}) as Record<string, unknown>
    const str = (k: string): string | null => (typeof props[k] === 'string' && props[k] ? (props[k] as string) : null)
    const consentRaw = str(PROP_CONSENT)
    return {
      completedAt: str(PROP_COMPLETED),
      consent: consentRaw === null ? null : consentRaw === 'true',
      plan: str(PROP_PLAN),
    }
  }

  async function saveOnboarding(patch: {
    completedAt?: string
    consent?: boolean
    plan?: string
  }): Promise<Result<true>> {
    const res = await updateSelf((row) => {
      const props = { ...((row.properties as Record<string, string> | undefined) ?? {}) }
      if (patch.completedAt !== undefined) props[PROP_COMPLETED] = patch.completedAt
      if (patch.consent !== undefined) props[PROP_CONSENT] = String(patch.consent)
      if (patch.plan !== undefined) props[PROP_PLAN] = patch.plan
      row.properties = props
    })
    return res.ok ? { ok: true, value: true } : res
  }

  async function listPlans(payUrl: string): Promise<PlanInfo[]> {
    try {
      const res = await f(trimSlash(payUrl) + '/v1/billing/plans', { headers: { Accept: 'application/json' } })
      if (!res.ok) return []
      const body = (await res.json()) as unknown
      const rows = Array.isArray(body) ? body : []
      return rows
        .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
        .map((r) => ({
          slug: typeof r.slug === 'string' ? r.slug : '',
          name: typeof r.name === 'string' ? r.name : '',
          description: typeof r.description === 'string' ? r.description : undefined,
          price: typeof r.price === 'number' ? r.price : NaN,
          priceAnnual: typeof r.priceAnnual === 'number' ? r.priceAnnual : undefined,
          popular: r.popular === true,
        }))
        .filter((p) => p.slug && p.name && Number.isFinite(p.price) && p.price > 0)
    } catch {
      return []
    }
  }

  /**
   * Read-merge-write the signed-in user's FULL row. IAM's update-user is a
   * FULL-ROW write (internal/users Update: "this is a full-row write") and it
   * ignores the v1 `columns=` scoping param — so a minimal body silently
   * blanks every field it omits. The wallet step used to do exactly that,
   * wiping displayName/email on every link. Every self-write goes through
   * here now: fetch the row, mutate, post the whole thing back.
   */
  async function updateSelf(mutate: (row: Record<string, unknown>) => void): Promise<Result<true>> {
    const row = await getAccount()
    if (!row) return { ok: false, error: 'not signed in' }
    const owner = typeof row.owner === 'string' ? row.owner : ''
    const name = typeof row.name === 'string' ? row.name : ''
    if (!owner || !name) return { ok: false, error: 'not signed in' }
    mutate(row)
    row.owner = owner
    row.name = name
    const url = new URL('/v1/iam/update-user', base)
    url.searchParams.set('id', `${owner}/${name}`)
    try {
      const res = await f(url.toString(), {
        method: 'POST',
        headers: await authHeaders(),
        credentials: 'include',
        body: JSON.stringify(row),
      })
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (body.status === 'error') return { ok: false, error: msgOf(body) }
      return { ok: true, value: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  }

  /** Read the signed-in user's FULL row from `/v1/iam/get-account`. */
  async function getAccount(): Promise<Record<string, unknown> | null> {
    const url = new URL('/v1/iam/get-account', base)
    try {
      const res = await f(url.toString(), { headers: await authHeaders(false), credentials: 'include' })
      if (!res.ok) return null
      const body = (await res.json()) as Record<string, unknown>
      const data = (body.data ?? body) as Record<string, unknown>
      if (typeof data !== 'object' || data === null) return null
      return data
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

  return { listOrgs, createOrg, createProject, linkWallet, readOnboarding, saveOnboarding, listPlans }
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

/** EIP-55-agnostic 0x-prefixed 20-byte address check. */
function isHexAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s)
}
