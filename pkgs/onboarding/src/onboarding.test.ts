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

// `skippable` is what renders a step's Skip button, so the table and the screen
// cannot disagree. org and consent have no Skip: an account needs a home org, and
// the consent question needs an answer — its checkbox already carries both, so
// unticked + Continue IS "no". plan CAN be deferred (a payment method is needed to
// USE the platform, not to leave onboarding) and its skip still records completion.
test('org and consent may not be skipped; project, wallet and plan may', () => {
  assert.equal(stepById('org')!.skippable, false)
  assert.equal(stepById('consent')!.skippable, false)
  assert.equal(stepById('project')!.skippable, true)
  assert.equal(stepById('wallet')!.skippable, true)
  assert.equal(stepById('plan')!.skippable, true)
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

// A wallet binding is a PROOF, not a field. This service has no wallet write at
// all: it used to post the address into `web3onboard`, a field schema.User does
// not have, so IAM's decoder dropped it and the step reported a link that stored
// nothing. The real door is the CAIP-122 one (nonce → sign → POST
// /v1/iam/web3/verify, which binds to the signed-in caller), driven by the host.
// Nothing here may write a user row.
test('the service has no wallet write, and never posts to update-user', async () => {
  const { service, calls } = harness(() => ({ json: { status: 'ok' } }))
  assert.equal('linkWallet' in service, false)
  // Drive everything the service DOES do, then prove no user-row write happened.
  await service.createOrg({ name: 'acme', displayName: 'Acme' })
  await service.saveOnboarding({ consent: true, plan: 'pro', completedAt: '2026-08-04T00:00:00Z' })
  await service.readOnboarding()
  assert.equal(
    calls.some((c) => c.url.includes('update-user')),
    false,
    'update-user is a full-row write; a partial body erases what it omits',
  )
})

// Onboarding's own bookkeeping goes to the SELF-SCOPED preferences store, never
// to update-user. A regular user is self-service for READS only on that verb
// (iam internal/authz/authz.go), so writing the flow's progress through it is a
// 403 — which is exactly what stranded a person on the data-sharing step with
// the box already ticked. The store shallow-merges, so this sends only what
// changed rather than a read-modify-write of the whole row.
test('saveOnboarding writes progress to the self-scoped preferences store, not update-user', async () => {
  const { service, calls } = harness(() => ({ json: { status: 'ok' } }))
  const res = await service.saveOnboarding({ plan: 'pro', completedAt: '2026-08-04T00:00:00Z' })
  assert.deepEqual(res, { ok: true, value: true })
  const wrote = calls.find((c) => c.url.includes('/v1/iam/preferences'))
  assert.ok(wrote, 'progress must go to /v1/iam/preferences')
  assert.equal(wrote!.method, 'POST')
  assert.deepEqual(JSON.parse(wrote!.body!), {
    'onboarding.plan': 'pro',
    'onboarding.completedAt': '2026-08-04T00:00:00Z',
  })
  assert.equal(
    calls.some((c) => c.url.includes('update-user')),
    false,
    'update-user is the admin door and refuses a self-write with 403',
  )
})

// Consent is not a preference and not a property: it has ONE canonical record
// behind PUT /v1/iam/consent, which is self-scoped by construction because
// "consent someone else can set on your behalf is not consent". Writing a second
// copy into properties would be the parallel table IAM's own comment refuses.
// The field is `training` — the question the screen's copy actually asks ("helps
// improve the models"). It was `insights`, which is a different switch: a bool
// already defaulting to TRUE, so agreeing changed nothing, left MayTrain() false,
// and wrote NO audit row because the record was identical before and after. The
// one screen that asks recorded an answer no data path could act on.
test('saveOnboarding answers TRAINING through PUT /v1/iam/consent', async () => {
  const yes = harness(() => ({ json: { status: 'ok' } }))
  assert.deepEqual(await yes.service.saveOnboarding({ consent: true }), { ok: true, value: true })
  const wrote = yes.calls.find((c) => c.url.includes('/v1/iam/consent'))
  assert.ok(wrote, 'consent must go to the consent endpoint')
  assert.equal(wrote!.method, 'PUT')
  // Absent means UNTOUCHED on that wire, so answering one question must not
  // silently answer the other — this screen asks ONE, so it sends ONE field.
  assert.deepEqual(JSON.parse(wrote!.body!), { training: 'granted' })
  assert.equal(
    yes.calls.some((c) => c.url.includes('update-user')),
    false,
  )

  // A refusal is recorded EXPLICITLY, not by silence: "refused" and "never asked"
  // are different states, and only the explicit one is an answer.
  const no = harness(() => ({ json: { status: 'ok' } }))
  await no.service.saveOnboarding({ consent: false })
  const refused = no.calls.find((c) => c.url.includes('/v1/iam/consent'))
  assert.deepEqual(JSON.parse(refused!.body!), { training: 'refused' })
})

// A failed consent write must FAIL the step. Reporting success and moving on
// would record an answer the account never received.
test('saveOnboarding surfaces a refused consent write instead of continuing', async () => {
  const { service } = harness((rec) =>
    rec.url.includes('/v1/iam/consent') ? { status: 403, json: {} } : { json: { status: 'ok' } },
  )
  const res = await service.saveOnboarding({ consent: true, completedAt: '2026-08-04T00:00:00Z' })
  assert.equal(res.ok, false)
})

// The consent arm is scripted with IAM's REAL default body — `insights:true,
// training:""` — which is what a fresh account returns from GET /v1/iam/consent.
// The previous version of this test answered every URL with a bare user row that
// had no `insights` key, so it passed while production read `consent: true` for a
// person who had never been asked. Reading `training` is what makes "never asked"
// representable, and it is the state the flow needs in order to ask.
test('readOnboarding reports consent null for an account that has never answered', async () => {
  const { service } = harness((rec) =>
    rec.url.includes('/v1/iam/consent')
      ? { json: { status: 'ok', data: { insights: true, training: '' } } }
      : { json: { status: 'ok', data: { owner: 'hanzo', name: 'bob' } } },
  )
  assert.deepEqual(await service.readOnboarding(), {
    completedAt: null,
    consent: null,
    plan: null,
    org: 'hanzo',
    admin: false,
  })
})

// The account is the whole resume signal: which org, whether this person ADMINS
// it (IAM's own first-run gate — it refuses a second org exactly then), and the
// two answers stored in the preferences blob.
test('readOnboarding reports the org, the admin flag, and the stored answers', async () => {
  const { service } = harness((rec) =>
    rec.url.includes('/v1/iam/consent')
      ? { json: { status: 'ok', data: { insights: true, training: 'granted' } } }
      : {
          json: {
            status: 'ok',
            data: {
              owner: 'acme',
              name: 'alice',
              isAdmin: true,
              properties: {
                'hanzo.preferences': JSON.stringify({
                  'onboarding.plan': 'payg',
                  'onboarding.completedAt': '2026-08-04T00:00:00Z',
                }),
              },
            },
          },
        },
  )
  assert.deepEqual(await service.readOnboarding(), {
    completedAt: '2026-08-04T00:00:00Z',
    consent: true,
    plan: 'payg',
    org: 'acme',
    admin: true,
  })
})

// A 2xx whose body is not JSON is NOT a receipt. It used to shrug the body off to
// `{}`, which carries no `status:"error"`, so an HTML 200 from a wrong path or a
// misrouted host reported a successful save — and from the plan step that meant
// onboarding presented itself as finished with nothing recorded.
test('a non-JSON 2xx is a failed write, not a silent success', async () => {
  const html = createOnboardingService({
    iamUrl: 'https://hanzo.id',
    orgId: 'hanzo',
    getAccessToken: () => 'tok-123',
    fetchImpl: (async () =>
      new Response('<!doctype html><title>hi</title>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })) as unknown as typeof fetch,
  })
  const res = await html.saveOnboarding({ plan: 'pro', completedAt: '2026-08-04T00:00:00Z' })
  assert.equal(res.ok, false)
  assert.match(res.ok === false ? res.error : '', /non-JSON/)
})

// The live catalog prices in CENTS (go=900 means $9/mo, priceAnnual=825 means
// $8.25/mo billed annually) and carries other product lines (dns-*) in the
// same list. This test pins both facts with production-shaped rows.
test('listPlans keeps cents unscaled, keeps personal+team only; [] on failure', async () => {
  const { service, calls } = harness(() => ({
    json: [
      { slug: 'pro', name: 'Pro', category: 'personal', price: 4900, priceAnnual: 4150, popular: true },
      { slug: 'go', name: 'Go', category: 'personal', price: 900, priceAnnual: 825 },
      { slug: 'team', name: 'Team', category: 'team', price: 2500, priceAnnual: 2000 },
      { slug: 'dns-pro', name: 'DNS Pro', category: 'dns', price: 500 }, // other product line → dropped
      { slug: 'enterprise', name: 'Enterprise', category: 'enterprise', price: 0 }, // not self-serve → dropped
      { slug: '', name: 'broken', category: 'personal', price: 500 }, // no slug → dropped
    ],
  }))
  const plans = await service.listPlans('https://pay.hanzo.ai/')
  assert.equal(calls[0]!.url, 'https://pay.hanzo.ai/v1/billing/plans')
  assert.deepEqual(
    plans.map((p) => p.slug),
    ['pro', 'go', 'team'],
  )
  assert.equal(plans[0]!.priceCents, 4900)
  assert.equal(plans[0]!.priceAnnualCents, 4150)
  assert.equal(plans[0]!.popular, true)

  const down = harness(() => ({ status: 503, json: { error: 'nope' } }))
  assert.deepEqual(await down.service.listPlans('https://pay.hanzo.ai'), [])
})

// An unreadable account must not look like a finished one: every answer reads as
// "not answered", so the flow asks rather than skipping a required step.
test('readOnboarding fails closed when the account cannot be read', async () => {
  const { service } = harness(() => ({ status: 401, json: { status: 'error', msg: 'not signed in' } }))
  assert.deepEqual(await service.readOnboarding(), {
    completedAt: null,
    consent: null,
    plan: null,
    org: null,
    admin: false,
  })
})

// ── The addresses IAM answers on ────────────────────────────────────
//
// A retired verb-noun answers 410 and names its successor in the body, so a
// stale address is a well-formed JSON refusal rather than a transport error —
// invisible to a reader that only looks for `{status:'ok'}`. These pin the two
// addresses this service holds to the ones the server declares.

test('createProject creates through the projects collection', async () => {
  const { service, calls } = harness(() => ({
    // Typed CRUD answers the ROW, with no envelope around it.
    json: { owner: 'acme', name: 'web', displayName: 'Web', organization: 'acme' },
  }))
  const res = await service.createProject({ organization: 'acme', name: 'web', displayName: 'Web' })

  assert.equal(calls[0]!.url, 'https://hanzo.id/v1/iam/projects')
  assert.equal(calls[0]!.method, 'POST')
  assert.ok(!calls.some((c) => c.url.includes('add-project')))
  assert.deepEqual(res, {
    ok: true,
    value: { owner: 'acme', name: 'web', displayName: 'Web', organization: 'acme' },
  })
})

// The refusal shape moves with the address: typed CRUD refuses with an RFC 9457
// problem document on a 4xx, whose `status` is a NUMBER and whose sentence is in
// `detail`. A reader looking for the envelope's `msg` finds nothing and reports
// "request failed" over the top of the only sentence worth showing.
test('createProject surfaces the problem document IAM refused with', async () => {
  const { service } = harness(() => ({
    status: 409,
    json: { type: 'about:blank', title: 'Conflict', status: 409, detail: 'project already exists' },
  }))
  const res = await service.createProject({ organization: 'acme', name: 'web', displayName: 'Web' })
  assert.deepEqual(res, { ok: false, error: 'project already exists' })
})

test('readOnboarding reads the account at the canonical address', async () => {
  const { service, calls } = harness(() => ({ json: { status: 'ok', data: { properties: {} } } }))
  await service.readOnboarding()
  const read = calls.find((c) => c.url.includes('/v1/iam/account'))
  assert.ok(read, 'the account is read at /v1/iam/account')
  assert.ok(!calls.some((c) => c.url.includes('get-account')))
})

// An account that could not be READ is not an account with nothing in it. The
// flow deliberately starts over when this throws; it must not start over because
// `{status:'error'}` was mistaken for a row whose every field is absent.
test('readOnboarding throws when the account read did not happen', async () => {
  const { service } = harness(() => ({ status: 410, json: { successor: ['/v1/iam/account'] } }))
  await assert.rejects(service.readOnboarding())
})
