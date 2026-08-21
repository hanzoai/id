/**
 * Onboarding unit tests — run with the Node built-in test runner and native
 * TypeScript stripping (no test-framework dependency):
 *
 *   node --test --experimental-strip-types src/onboarding.test.ts
 *
 * Covers the React-free surface: the domain step machine and the service's
 * request shaping + IAM response translation (with an injected fake fetch).
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { STEPS, stepById, nextStep, prevStep } from './domain/types.ts'
import { createOnboardingService } from './service/onboarding.ts'

// ── Domain: step machine ────────────────────────────────────────────

test('step machine walks org → project → wallet → done', () => {
  assert.equal(STEPS[0]!.id, 'org')
  assert.equal(nextStep('org'), 'project')
  assert.equal(nextStep('project'), 'wallet')
  assert.equal(nextStep('wallet'), 'done')
  assert.equal(nextStep('done'), 'done') // terminal is a fixpoint
})

test('prevStep is the inverse within the flow, undefined at the head', () => {
  assert.equal(prevStep('org'), undefined)
  assert.equal(prevStep('project'), 'org')
  assert.equal(prevStep('wallet'), 'project')
})

test('only org is required; project and wallet are skippable', () => {
  assert.equal(stepById('org')!.skippable, false)
  assert.equal(stepById('project')!.skippable, true)
  assert.equal(stepById('wallet')!.skippable, true)
})

// ── Service: fake-fetch harness ─────────────────────────────────────

interface Recorded {
  url: string
  method: string
  body?: string
  headers: Record<string, string>
}

/** Build a service whose fetch records calls and returns scripted JSON. */
function harness(script: (rec: Recorded) => { status?: number; json: unknown }) {
  const calls: Recorded[] = []
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    const h = init?.headers as Record<string, string> | undefined
    if (h) for (const k of Object.keys(h)) headers[k] = h[k]!
    const rec: Recorded = {
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
      headers,
    }
    calls.push(rec)
    const { status = 200, json } = script(rec)
    return new Response(JSON.stringify(json), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch

  const service = createOnboardingService({
    iamUrl: 'https://hanzo.id',
    orgId: 'hanzo',
    getAccessToken: () => 'tok-123',
    fetchImpl,
  })
  return { service, calls }
}

/**
 * The org list is the MEMBERSHIP relation, never the org registry.
 * `/v1/iam/organizations` is SuperAdmin-only for a listing — its rows are filed
 * under the reserved `admin` owner, where a read is authorized by
 * `memberOf(name)` and a nameless list can never satisfy that — so pointing this
 * at the registry would 403 for every ordinary person onboarding.
 */
test('listOrgs reads the membership relation, not the SuperAdmin-only org registry', async () => {
  const { service, calls } = harness((rec) => {
    if (rec.url.includes('/v1/iam/account'))
      return { json: { status: 'ok', data: { owner: 'hanzo', name: 'alice' }, data2: { name: 'hanzo', displayName: 'Hanzo' } } }
    return { json: { status: 'ok', data: [{ user: 'hanzo/alice', org: 'hanzo', role: 'admin' }, { user: 'hanzo/alice', org: 'acme', role: 'member' }], data2: 2 } }
  })
  const orgs = await service.listOrgs()

  assert.match(calls[0]!.url, /\/v1\/iam\/account$/)
  assert.equal(calls[1]!.url, 'https://hanzo.id/v1/iam/memberships?user=hanzo%2Falice')
  assert.equal(calls[1]!.headers.Authorization, 'Bearer tok-123')
  // The RETIRED verb, by name — the SuperAdmin-only org registry this read
  // must never reach for.
  assert.ok(!calls.some((c) => c.url.includes('get-organizations')))
  // The home org leads and keeps its display name; a membership-only org falls
  // back to its slug, which is the only name that relation carries.
  assert.deepEqual(orgs, [
    { name: 'hanzo', displayName: 'Hanzo' },
    { name: 'acme', displayName: 'acme' },
  ])
})

/**
 * `data2` on this envelope is the COUNT (`httpx.Good(rows, len(rows))`), never a
 * second row source. Reading it as rows would decode a number as a list.
 */
test('listOrgs takes rows from data alone and never from the data2 count', async () => {
  const { service } = harness((rec) => {
    if (rec.url.includes('/v1/iam/account'))
      return { json: { status: 'ok', data: { owner: 'hanzo', name: 'alice' }, data2: { name: 'hanzo', displayName: 'Hanzo' } } }
    return { json: { status: 'ok', data: [], data2: 0 } }
  })
  assert.deepEqual(await service.listOrgs(), [{ name: 'hanzo', displayName: 'Hanzo' }])
})

test('listOrgs keeps the home org when the membership read fails', async () => {
  const { service } = harness((rec) => {
    if (rec.url.includes('/v1/iam/account'))
      return { json: { status: 'ok', data: { owner: 'hanzo', name: 'alice' }, data2: { name: 'hanzo', displayName: 'Hanzo' } } }
    return { status: 500, json: { status: 500, error: 'boom' } }
  })
  assert.deepEqual(await service.listOrgs(), [{ name: 'hanzo', displayName: 'Hanzo' }])
})

test('listOrgs returns [] (not throw) when nobody is signed in', async () => {
  const { service } = harness(() => ({ status: 401, json: { status: 'error', msg: 'please sign in first' } }))
  assert.deepEqual(await service.listOrgs(), [])
})

// Founding an org goes through the SELF-SERVICE front door, never the
// add-organization admin verb — that one is bearer-only entity CRUD filed under
// owner "admin", so a person founding their first org gets 401/403 there. This is
// the regression guard for the hanzo.id/onboarding "HTTP 401".
test('createOrg founds the org through /v1/iam/onboard, never the admin verb', async () => {
  const ok = harness(() => ({ json: { org: 'acme', accessKey: 'pk-live-x' } }))
  const res = await ok.service.createOrg({ name: 'acme', displayName: 'Acme Inc' })
  assert.equal(ok.calls[0]!.url, 'https://hanzo.id/v1/iam/onboard')
  assert.equal(ok.calls[0]!.method, 'POST')
  assert.ok(!ok.calls.some((c) => c.url.includes('add-organization')))
  // The DISPLAY name is what travels: the server owns the slug policy.
  assert.deepEqual(JSON.parse(ok.calls[0]!.body!), { name: 'Acme Inc' })
  // …and the slug it answers with is authoritative, not the client's guess.
  assert.deepEqual(res, { ok: true, value: { name: 'acme', displayName: 'Acme Inc' } })
})

test('createOrg carries BOTH credentials — the portal session mints no bearer', async () => {
  const { service, calls } = harness(() => ({ json: { org: 'acme' } }))
  await service.createOrg({ name: 'acme', displayName: 'Acme Inc' })
  assert.equal(calls[0]!.headers.Authorization, 'Bearer tok-123')
  assert.equal(calls[0]!.headers['Content-Type'], 'application/json')
})

test('createOrg surfaces the front door’s own error text, not a bare HTTP code', async () => {
  const taken = harness(() => ({ status: 409, json: { error: 'the organization "acme" already exists' } }))
  assert.deepEqual(await taken.service.createOrg({ name: 'acme', displayName: 'Acme' }), {
    ok: false,
    error: 'the organization "acme" already exists',
  })

  const anon = harness(() => ({ status: 401, json: { error: 'please sign in first' } }))
  assert.deepEqual(await anon.service.createOrg({ name: 'x', displayName: 'X' }), {
    ok: false,
    error: 'please sign in first',
  })
})

test('createProject writes the project to the native entity route', async () => {
  const { service, calls } = harness(() => ({
    json: { owner: 'acme', name: 'api', displayName: 'API', organization: 'acme' },
  }))
  const res = await service.createProject({ organization: 'acme', name: 'api', displayName: 'API' })
  assert.equal(calls[0]!.url, 'https://hanzo.id/v1/iam/projects')
  assert.equal(calls[0]!.method, 'POST')
  // The RETIRED verb, by name: this guards against regressing to it, so it
  // must keep spelling the address it forbids.
  assert.ok(!calls.some((c) => c.url.includes('add-project')))
  assert.deepEqual(JSON.parse(calls[0]!.body!), {
    owner: 'acme',
    name: 'api',
    displayName: 'API',
    organization: 'acme',
    isDefault: false,
  })
  assert.deepEqual(res, {
    ok: true,
    value: { owner: 'acme', name: 'api', displayName: 'API', organization: 'acme' },
  })
})

/**
 * A native entity route answers with the RECORD and signals failure with the
 * HTTP code — there is no `status:"ok"` to branch on, so a 2xx IS the success
 * and zip's `{status:<code>, error}` carries the reason.
 */
test('createProject reports the reason from a native error body, not a bare code', async () => {
  const { service } = harness(() => ({ status: 409, json: { status: 409, error: 'project already exists' } }))
  assert.deepEqual(await service.createProject({ organization: 'acme', name: 'api', displayName: 'API' }), {
    ok: false,
    error: 'project already exists',
  })
})

/**
 * Wallet linking is NOT a record write and so is not on this service at all. A
 * wallet binds to an identity by PROVING the key (CAIP-122 — mint a challenge,
 * sign it, verify it), which is the auth pkg's `loginWithWalletChain` against
 * `/v1/iam/web3/{nonce,verify}`. The field the old write set (`web3onboard`) is
 * not on IAM's user at all, so that write decoded to a row asking for NO change.
 */
test('the service exposes no wallet write — a wallet binds by proof, not by assertion', () => {
  const { service } = harness(() => ({ json: {} }))
  assert.deepEqual(Object.keys(service).sort(), ['createOrg', 'createProject', 'listOrgs'])
})
