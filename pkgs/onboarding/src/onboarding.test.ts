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

test('step machine walks org → project → wallet → consent → plan → done', () => {
  assert.equal(STEPS[0]!.id, 'org')
  assert.equal(nextStep('org'), 'project')
  assert.equal(nextStep('project'), 'wallet')
  assert.equal(nextStep('wallet'), 'consent')
  assert.equal(nextStep('consent'), 'plan')
  assert.equal(nextStep('plan'), 'done')
  assert.equal(nextStep('done'), 'done') // terminal is a fixpoint
})

test('prevStep is the inverse within the flow, undefined at the head', () => {
  assert.equal(prevStep('org'), undefined)
  assert.equal(prevStep('project'), 'org')
  assert.equal(prevStep('wallet'), 'project')
  assert.equal(prevStep('consent'), 'wallet')
  assert.equal(prevStep('plan'), 'consent')
})

test('project and wallet are skippable; org, consent and plan are not', () => {
  assert.equal(stepById('org')!.skippable, false)
  assert.equal(stepById('project')!.skippable, true)
  assert.equal(stepById('wallet')!.skippable, true)
  // Consent needs an ANSWER (either answer) and plan is the prepay gate —
  // neither may be walked past. plan is LAST so the choice hands straight
  // off to the pay surface.
  assert.equal(stepById('consent')!.skippable, false)
  assert.equal(stepById('plan')!.skippable, false)
  assert.equal(STEPS[STEPS.length - 1]!.id, 'plan')
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

test('listOrgs hits get-organizations with the bearer token and maps rows', async () => {
  const { service, calls } = harness(() => ({
    json: { status: 'ok', data: [{ name: 'hanzo', displayName: 'Hanzo' }, { name: 'acme' }] },
  }))
  const orgs = await service.listOrgs()
  assert.equal(calls[0]!.url, 'https://hanzo.id/v1/iam/get-organizations')
  assert.equal(calls[0]!.headers.Authorization, 'Bearer tok-123')
  assert.deepEqual(orgs, [
    { name: 'hanzo', displayName: 'Hanzo' },
    { name: 'acme', displayName: 'acme' }, // displayName falls back to name
  ])
})

test('listOrgs decodes rows from the legacy data2 slot until IAM stops emitting it', async () => {
  const { service } = harness(() => ({ json: { status: 'ok', data2: [{ name: 'acme' }] } }))
  assert.deepEqual(await service.listOrgs(), [{ name: 'acme', displayName: 'acme' }])
})

test('listOrgs returns [] (not throw) on a server error', async () => {
  const { service } = harness(() => ({ status: 500, json: { status: 'error', msg: 'boom' } }))
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

test('linkWallet rejects a malformed address before any network call', async () => {
  const { service, calls } = harness(() => ({ json: { status: 'ok' } }))
  const res = await service.linkWallet('not-an-address')
  assert.deepEqual(res, { ok: false, error: 'invalid wallet address' })
  assert.equal(calls.length, 0)
})

// IAM's update-user is a FULL-ROW write that ignores `columns=` — a minimal
// body silently blanks every field it omits. So the contract under test is
// read-merge-write: the row that comes back from get-account goes back OUT
// with only the mutation applied. This is the regression guard for the wallet
// step wiping displayName/email on every link.
test('linkWallet reads the full row and writes it back with web3onboard merged in', async () => {
  const addr = '0x' + 'a'.repeat(40)
  const { service, calls } = harness((rec) => {
    if (rec.url.includes('get-account'))
      return {
        json: {
          status: 'ok',
          data: { owner: 'hanzo', name: 'alice', displayName: 'Alice', email: 'alice@hanzo.ai' },
        },
      }
    return { json: { status: 'ok' } }
  })
  const res = await service.linkWallet(addr)
  assert.deepEqual(res, { ok: true, value: addr })
  // 1) get-account, 2) update-user keyed by owner/name with the WHOLE row
  assert.match(calls[0]!.url, /get-account$/)
  const upd = calls[1]!
  assert.ok(upd.url.includes('/v1/iam/update-user'))
  assert.ok(upd.url.includes('id=hanzo%2Falice') || upd.url.includes('id=hanzo/alice'))
  const sent = JSON.parse(upd.body!)
  assert.equal(sent.web3onboard, addr)
  assert.equal(sent.owner, 'hanzo')
  assert.equal(sent.name, 'alice')
  // The fields the mutation did not touch MUST survive the round trip.
  assert.equal(sent.displayName, 'Alice')
  assert.equal(sent.email, 'alice@hanzo.ai')
})

test('saveOnboarding merges properties without dropping existing ones; readOnboarding decodes them', async () => {
  const { service, calls } = harness((rec) => {
    if (rec.url.includes('get-account'))
      return {
        json: {
          status: 'ok',
          data: {
            owner: 'hanzo',
            name: 'alice',
            properties: { 'onboarding.dataSharingConsent': 'true', unrelated: 'kept' },
          },
        },
      }
    return { json: { status: 'ok' } }
  })
  const res = await service.saveOnboarding({ plan: 'pro', completedAt: '2026-08-04T00:00:00Z' })
  assert.deepEqual(res, { ok: true, value: true })
  const sent = JSON.parse(calls[1]!.body!)
  assert.deepEqual(sent.properties, {
    'onboarding.dataSharingConsent': 'true',
    unrelated: 'kept',
    'onboarding.plan': 'pro',
    'onboarding.completedAt': '2026-08-04T00:00:00Z',
  })
})

test('readOnboarding reports null completedAt/consent/plan for a fresh user', async () => {
  const { service } = harness(() => ({ json: { status: 'ok', data: { owner: 'hanzo', name: 'bob' } } }))
  assert.deepEqual(await service.readOnboarding(), { completedAt: null, consent: null, plan: null })
})

test('listPlans maps the pay catalog and filters malformed rows; [] on failure', async () => {
  const { service, calls } = harness(() => ({
    json: [
      { slug: 'pro', name: 'Pro', price: 19, priceAnnual: 199, popular: true },
      { slug: 'dev', name: 'Dev', price: 9 },
      { slug: '', name: 'broken', price: 5 }, // no slug → dropped
      { slug: 'free', name: 'Free', price: 0 }, // not a paid plan → dropped
    ],
  }))
  const plans = await service.listPlans('https://pay.hanzo.ai/')
  assert.equal(calls[0]!.url, 'https://pay.hanzo.ai/v1/billing/plans')
  assert.deepEqual(
    plans.map((p) => p.slug),
    ['pro', 'dev'],
  )
  assert.equal(plans[0]!.priceAnnual, 199)
  assert.equal(plans[0]!.popular, true)

  const down = harness(() => ({ status: 503, json: { error: 'nope' } }))
  assert.deepEqual(await down.service.listPlans('https://pay.hanzo.ai'), [])
})

test('linkWallet fails closed when there is no signed-in user', async () => {
  const addr = '0x' + 'b'.repeat(40)
  const { service } = harness((rec) => {
    if (rec.url.includes('get-account')) return { status: 401, json: { status: 'error', msg: 'not signed in' } }
    return { json: { status: 'ok' } }
  })
  assert.deepEqual(await service.linkWallet(addr), { ok: false, error: 'not signed in' })
})
