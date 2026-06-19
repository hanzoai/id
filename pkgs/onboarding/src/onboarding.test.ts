/**
 * Onboarding unit tests — run with the Node built-in test runner and native
 * TypeScript stripping (no test-framework dependency):
 *
 *   node --test --experimental-strip-types src/onboarding.test.ts
 *
 * Covers the React-free surface: the domain step machine and the service's
 * request shaping + IAM response translation (with an injected fake fetch).
 */
import { test } from 'node:test'
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

test('createOrg posts the org and reports IAM error messages', async () => {
  const ok = harness(() => ({ json: { status: 'ok' } }))
  const res = await ok.service.createOrg({ name: 'acme', displayName: 'Acme Inc' })
  assert.equal(ok.calls[0]!.url, 'https://hanzo.id/v1/iam/add-organization')
  assert.equal(ok.calls[0]!.method, 'POST')
  const sent = JSON.parse(ok.calls[0]!.body!)
  assert.equal(sent.name, 'acme')
  assert.equal(sent.displayName, 'Acme Inc')
  assert.deepEqual(res, { ok: true, value: { name: 'acme', displayName: 'Acme Inc' } })

  const denied = harness(() => ({ status: 403, json: { status: 'error', msg: 'permission denied' } }))
  const fail = await denied.service.createOrg({ name: 'x', displayName: 'X' })
  assert.deepEqual(fail, { ok: false, error: 'HTTP 403' })
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
