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

test('step machine walks org → project → wallet → consent → done', () => {
  assert.equal(STEPS[0]!.id, 'org')
  assert.equal(nextStep('org'), 'project')
  assert.equal(nextStep('project'), 'wallet')
  assert.equal(nextStep('wallet'), 'consent')
  assert.equal(nextStep('consent'), 'done')
  assert.equal(nextStep('done'), 'done') // terminal is a fixpoint
})

test('prevStep is the inverse within the flow, undefined at the head', () => {
  assert.equal(prevStep('org'), undefined)
  assert.equal(prevStep('project'), 'org')
  assert.equal(prevStep('wallet'), 'project')
  assert.equal(prevStep('consent'), 'wallet')
})

test('org and consent are required; project and wallet are skippable', () => {
  assert.equal(stepById('org')!.skippable, false)
  assert.equal(stepById('project')!.skippable, true)
  assert.equal(stepById('wallet')!.skippable, true)
  // Consent is NOT skippable: an unanswered question is not permission, so a
  // skip would record nothing and leave the account still needing to be asked.
  assert.equal(stepById('consent')!.skippable, false)
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

// ── Service: consent ────────────────────────────────────────────────

test('setConsent PUTs the dedicated consent endpoint, never update-user', async () => {
  const { service, calls } = harness(() => ({ json: { insights: true, training: 'granted' } }))
  const res = await service.setConsent({ training: 'granted' })
  assert.equal(res.ok, true)
  assert.equal(calls.length, 1)
  // The endpoint is what makes this work at all: answering through the legacy
  // update-user verb is an admin-scoped entity write and refuses a person
  // recording their own consent with a 403.
  assert.equal(new URL(calls[0]!.url).pathname, '/v1/iam/consent')
  assert.equal(calls[0]!.method, 'PUT')
  assert.ok(!calls[0]!.url.includes('update-user'))
  assert.ok(!calls[0]!.url.includes('preferences'))
})

test('setConsent sends ONLY the field it was asked to change', async () => {
  const { service, calls } = harness(() => ({ json: { insights: true, training: 'refused' } }))
  await service.setConsent({ training: 'refused' })
  const body = JSON.parse(calls[0]!.body!) as Record<string, unknown>
  // Absent means UNTOUCHED on the wire. Naming `insights` here would answer a
  // question this screen never asked and could revoke a standing choice.
  assert.deepEqual(Object.keys(body), ['training'])
  assert.equal(body.training, 'refused')
})

test('setConsent refuses to send an empty patch', async () => {
  const { service, calls } = harness(() => ({ json: {} }))
  const res = await service.setConsent({})
  assert.equal(res.ok, false)
  assert.equal(calls.length, 0) // no request at all, rather than a no-op write
})

test('setConsent surfaces the server message on refusal', async () => {
  const { service } = harness(() => ({ status: 403, json: { status: 'error', msg: 'please sign in first' } }))
  const res = await service.setConsent({ training: 'granted' })
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.error, 'please sign in first')
})

test('getConsent reads the endpoint and unwraps the data envelope', async () => {
  const { service, calls } = harness(() => ({ json: { status: 'ok', data: { insights: false, training: 'granted' } } }))
  const c = await service.getConsent()
  assert.equal(calls[0]!.method, 'GET')
  assert.equal(new URL(calls[0]!.url).pathname, '/v1/iam/consent')
  assert.deepEqual(c, { insights: false, training: 'granted' })
})

test('an unreadable or unrecognized consent record degrades to UNANSWERED, never a grant', async () => {
  // A token this version does not know is not a grant. Coercing it would let a
  // corrupt record read as permission, so it fails closed instead.
  const weird = harness(() => ({ json: { insights: true, training: 'GRANTED ' } }))
  assert.deepEqual(await weird.service.getConsent(), { insights: true, training: '' })

  // A failed read resolves to IAM's own defaults: insights on, still-ask.
  const broken = harness(() => ({ status: 500, json: { status: 'error' } }))
  assert.deepEqual(await broken.service.getConsent(), { insights: true, training: '' })
})
