/**
 * Onboarding service — the IAM-backed implementation of the org/project/
 * wallet flow.
 *
 * One way: every write goes through the canonical IAM REST surface under
 * `/v1/iam/*` (the same IAM paths the auth client uses). There is no separate
 * onboarding backend — the org and project records live in IAM, which is the
 * identity registry.
 *
 *   createOrg()   POST /v1/iam/onboard             (the self-service front door)
 *   createProject POST /v1/iam/add-project
 *
 * Binding a wallet is NOT here. It is a proof, not a field: the person signs a
 * CAIP-122 challenge and IAM records the (chain, address) binding at
 * POST /v1/iam/web3/verify, which attaches it to the signed-in caller. That is
 * one call the auth pkg already makes, so the host performs it and this service
 * has no wallet write to get wrong — it had one, writing an address into a user
 * field that does not exist, and it persisted nothing.
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
  PREFERENCES_KEY,
  PROP_COMPLETED,
  PROP_PLAN,
  type Answers,
  type OrgRef,
  type PlanInfo,
  type ProjectRef,
} from '../domain/types'

/** Result of a write that can fail gracefully (no throw on expected errors). */
export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

export interface OnboardingService {
  /** Create a new organization owned by the user. */
  createOrg(input: { name: string; displayName: string }): Promise<Result<OrgRef>>
  /** Create a project inside `organization`. */
  createProject(input: { organization: string; name: string; displayName: string }): Promise<Result<ProjectRef>>
  /**
   * Everything the ACCOUNT already answers about onboarding — which step is
   * outstanding, and which are done. All-null/false for a brand-new account;
   * `completedAt` set means the host must not mount the flow at all.
   */
  readOnboarding(): Promise<Answers>
  /**
   * Persist onboarding fields onto the account. THIS is what stops the flow
   * repeating: what got answered lives on the USER, not in any browser storage,
   * so a new device, a cleared cache and a re-login all see it done.
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

  async function readOnboarding(): Promise<Answers> {
    const row = await getAccount()
    const props = (row?.properties ?? {}) as Record<string, unknown>
    // Preferences are ONE JSON blob under `hanzo.preferences`, not bare property
    // keys — that is the shape POST /v1/iam/preferences merges into, so the read
    // has to look where the write lands or the flow re-asks a question the user
    // already answered.
    let prefs: Record<string, unknown> = {}
    const blob = props[PREFERENCES_KEY]
    if (typeof blob === 'string' && blob) {
      try {
        const parsed = JSON.parse(blob) as unknown
        if (parsed && typeof parsed === 'object') prefs = parsed as Record<string, unknown>
      } catch {
        // A corrupt blob reads as "never answered" rather than throwing the flow.
      }
    }
    const str = (k: string): string | null => {
      const v = prefs[k] ?? props[k]
      return typeof v === 'string' && v ? v : null
    }
    return {
      completedAt: str(PROP_COMPLETED),
      // Consent has its OWN canonical record and its own endpoint; reading it out
      // of properties would read a stale copy of an answer stored elsewhere.
      consent: await readConsent(),
      plan: str(PROP_PLAN),
      // The org, and whether this account ADMINS it — IAM's own first-run gate,
      // so the org step is retired on the same condition IAM would refuse a
      // second org on. Both come off the account row already fetched above.
      org: typeof row?.owner === 'string' && row.owner ? row.owner : null,
      admin: row?.isAdmin === true,
    }
  }

  /**
   * The account-canonical data-sharing answer, from GET /v1/iam/consent.
   *
   * Reads `training`, the TRI-STATE: "granted" true, "refused" false, and the
   * empty string null — never asked. That last state is the one the flow needs,
   * and it is why the answer cannot be read from `insights`: insights is a bool
   * defaulting to TRUE, so every fresh account reported consent already given
   * and the step could not tell a granted answer from an unasked question.
   *
   * Returns null when the endpoint cannot be read, which the flow treats as
   * unanswered and therefore still asks — the safe direction.
   */
  async function readConsent(): Promise<boolean | null> {
    const url = new URL('/v1/iam/consent', base)
    try {
      const res = await f(url.toString(), { headers: await authHeaders(false), credentials: 'include' })
      if (!res.ok) return null
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      const data = (body.data ?? body) as Record<string, unknown>
      if (data.training === 'granted') return true
      if (data.training === 'refused') return false
      return null
    } catch {
      return null
    }
  }

  /**
   * Record the data-sharing answer through IAM's OWN consent door.
   *
   * Consent does NOT ride in `properties` via update-user. That verb is entity
   * CRUD behind the authenticated Guard, where a regular user is self-service
   * for READS only (internal/authz/authz.go: "Regular user — self-service only:
   * reading its own user record"), so a person answering the onboarding question
   * about their own account was refused 403 and the step could not be completed.
   *
   * PUT /v1/iam/consent is the door built for exactly this, and it is SELF-SCOPED
   * by construction: the target is always callerOf(), never a body field, because
   * "consent someone else can set on your behalf is not consent". It writes the
   * account-canonical record the extension and hanzo.ai already read, on the same
   * preferences blob, and audits the before/after on the same transaction.
   *
   * Widening update-user for self would have been the wrong repair: it would let
   * a caller write any field on their own row — isAdmin, roles, organization —
   * which is the privilege-escalation shape the consent endpoint exists to avoid.
   *
   * Every field on the wire is optional on purpose: absent means UNTOUCHED, so
   * answering one question cannot silently revoke the other. This screen asks ONE
   * question, so it sends ONE field.
   *
   * That field is `training` — "may Hanzo train on your data" — which is the
   * question the step's copy actually asks ("helps improve the models"). It was
   * `insights`, and answering the wrong switch made the whole step inert: insights
   * is a bool already defaulting to TRUE, so agreeing changed nothing, left
   * MayTrain() false, and produced NO audit row, because the record was identical
   * before and after. Training is the tri-state whose grant is auditable and whose
   * unanswered state is representable, which is what an agreement recorded once
   * needs. Analytics is a default-on opt-OUT with a usable "not set" state and
   * belongs in account settings, not in a first-run screen.
   */
  async function saveConsent(consent: boolean): Promise<Result<true>> {
    const url = new URL('/v1/iam/consent', base)
    try {
      const res = await f(url.toString(), {
        method: 'PUT',
        headers: await authHeaders(),
        credentials: 'include',
        body: JSON.stringify({ training: consent ? 'granted' : 'refused' }),
      })
      const r = await receipt(res)
      return r.ok ? { ok: true, value: true } : r
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  }

  async function saveOnboarding(patch: {
    completedAt?: string
    consent?: boolean
    plan?: string
  }): Promise<Result<true>> {
    // The answer itself goes to the canonical consent record, not to properties.
    if (patch.consent !== undefined) {
      const c = await saveConsent(patch.consent)
      if (!c.ok) return c
    }
    // completedAt / plan are onboarding's own bookkeeping — where the flow got to,
    // not what the user consented to. They go to the self-scoped preferences
    // store, whose own contract names "onboarding-completed flag" as the example
    // use, NOT to update-user: that verb refuses a regular user's self-write the
    // same way it refused the consent above, so routing only consent away from it
    // would have moved the 403 one step later instead of removing it.
    //
    // The store shallow-merges top-level keys and returns the merged object, so
    // two products writing DIFFERENT keys cannot clobber each other — which is
    // why this sends only what changed rather than a whole row read-modify-write.
    if (patch.completedAt === undefined && patch.plan === undefined) {
      return { ok: true, value: true }
    }
    const prefs: Record<string, string> = {}
    if (patch.completedAt !== undefined) prefs[PROP_COMPLETED] = patch.completedAt
    if (patch.plan !== undefined) prefs[PROP_PLAN] = patch.plan
    const url = new URL('/v1/iam/preferences', base)
    try {
      const res = await f(url.toString(), {
        method: 'POST',
        headers: await authHeaders(),
        credentials: 'include',
        body: JSON.stringify(prefs),
      })
      const r = await receipt(res)
      return r.ok ? { ok: true, value: true } : r
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  }

  async function listPlans(payUrl: string): Promise<PlanInfo[]> {
    try {
      const res = await f(trimSlash(payUrl) + '/v1/billing/plans', { headers: { Accept: 'application/json' } })
      if (!res.ok) return []
      const body = (await res.json()) as unknown
      const rows = Array.isArray(body) ? body : []
      return rows
        .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
        // Onboarding offers the account plans; other product lines in the same
        // catalog (dns-*, enterprise) have their own surfaces.
        .filter((r) => r.category === 'personal' || r.category === 'team')
        .map((r) => ({
          slug: typeof r.slug === 'string' ? r.slug : '',
          name: typeof r.name === 'string' ? r.name : '',
          description: typeof r.description === 'string' ? r.description : undefined,
          // Catalog prices are CENTS (900 = $9/mo); passed through unscaled.
          priceCents: typeof r.price === 'number' ? r.price : NaN,
          priceAnnualCents: typeof r.priceAnnual === 'number' && r.priceAnnual > 0 ? r.priceAnnual : undefined,
          popular: r.popular === true,
        }))
        .filter((p) => p.slug && p.name && Number.isFinite(p.priceCents) && p.priceCents > 0)
    } catch {
      return []
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
      const r = await receipt(res)
      return r.ok ? { ok: true, value: onOk() } : r
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  }

  return { createOrg, createProject, readOnboarding, saveOnboarding, listPlans }
}

/**
 * Read a write's answer as an IAM envelope — the ONE place a write decides
 * whether it succeeded.
 *
 * A body the client cannot read is not a receipt. This used to shrug a
 * non-JSON body off to `{}`, which carries no `status:"error"`, so an HTML 200
 * from a wrong path or a misrouted host reported a successful save — and for the
 * plan step that meant onboarding presented itself as completed with nothing
 * recorded.
 */
async function receipt(res: Response): Promise<Result<Record<string, unknown>>> {
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { ok: false, error: `HTTP ${res.status} non-JSON response` }
  }
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: `HTTP ${res.status} non-JSON response` }
  }
  const env = body as Record<string, unknown>
  if (env.status === 'error') return { ok: false, error: msgOf(env) }
  return { ok: true, value: env }
}

function msgOf(body: Record<string, unknown>): string {
  return typeof body.msg === 'string' && body.msg ? body.msg : 'request failed'
}
