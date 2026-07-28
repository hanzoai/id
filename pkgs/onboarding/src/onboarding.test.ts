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

test('linkWallet resolves the user via get-account then writes web3onboard', async () => {
  const addr = '0x' + 'a'.repeat(40)
  const { service, calls } = harness((rec) => {
    if (rec.url.includes('get-account')) return { json: { status: 'ok', data: { owner: 'hanzo', name: 'alice' } } }
    return { json: { status: 'ok' } }
  })
  const res = await service.linkWallet(addr)
  assert.deepEqual(res, { ok: true, value: addr })
  // 1) get-account, 2) update-user keyed by owner/name, column-scoped
  assert.match(calls[0]!.url, /get-account$/)
  const upd = calls[1]!
  assert.ok(upd.url.includes('/v1/iam/update-user'))
  assert.ok(upd.url.includes('id=hanzo%2Falice') || upd.url.includes('id=hanzo/alice'))
  assert.ok(upd.url.includes('columns=web3onboard'))
  const sent = JSON.parse(upd.body!)
  assert.equal(sent.web3onboard, addr)
  assert.equal(sent.owner, 'hanzo')
  assert.equal(sent.name, 'alice')
})

test('linkWallet fails closed when there is no signed-in user', async () => {
  const addr = '0x' + 'b'.repeat(40)
  const { service } = harness((rec) => {
    if (rec.url.includes('get-account')) return { status: 401, json: { status: 'error', msg: 'not signed in' } }
    return { json: { status: 'ok' } }
  })
  assert.deepEqual(await service.linkWallet(addr), { ok: false, error: 'not signed in' })
})
