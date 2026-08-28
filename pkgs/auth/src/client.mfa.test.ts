/**
 * MFA wiring tests — pure, no network (fetch is mocked via `fetchImpl`).
 * Run with: pnpm --filter @hanzo/id-auth test
 *
 * Locks the wire contract verified live against iam.hanzo.ai:
 *  - login answers a forced-MFA org with `data:"RequiredMfa"` (enroll) or
 *    `data:"NextMfa"` + the challenge list — named `mfa` first, legacy
 *    `data2`; both decode until the legacy slot is deleted. STRINGS, never a
 *    boolean.
 *  - the `/v1/iam/mfa/setup/*` calls carry their parameters as a JSON BODY, and
 *    `enable` carries the PASSCODE that proves possession.
 *  - the challenge re-POSTs `/v1/iam/login` with `{mfaType,passcode}` and NO
 *    username, riding the MFA session cookie.
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import type { Org } from '@hanzo/id-shared'
import { createAuthClient, mfaChannelOf, MFA_TOTP } from './client.ts'

const TENANT: Org = {
  orgId: 'hanzo',
  iamUrl: 'https://hanzo.id',
  iamIssuer: 'https://hanzo.id',
  clientId: 'hanzo-id',
  appName: 'hanzo-id',
  publicOrigin: 'https://hanzo.id',
  brandPackage: '@hanzo/brand',
}

type Call = { url: string; init: RequestInit }

function mockFetch(body: unknown, calls: Call[]): typeof fetch {
  return (async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
}

test('login → RequiredMfa maps to an enroll signal (not a redirect)', async () => {
  const calls: Call[] = []
  const client = createAuthClient({ org: TENANT, fetchImpl: mockFetch({ status: 'ok', data: 'RequiredMfa' }, calls) })
  const res = await client.login({
    identifier: 'davelorenzini@gmail.com',
    password: 'x',
    clientId: 'hanzo-id',
    application: 'hanzo-id',
    organization: 'hanzo',
  })
  assert.equal(res.mfaRequired, true)
  assert.equal(res.mfaStage, 'enroll')
  assert.equal(res.redirectUrl, undefined, 'must NOT short-circuit to /onboarding')
})

const CHALLENGE = [{ mfaType: 'app', enabled: true }, { mfaType: 'sms', enabled: true }]

// Both spellings decode until IAM's envelope rename lands everywhere and the
// legacy slot is deleted: named `mfa` (new), untyped `data2` (legacy), and
// named-first precedence when a transitional server sends both.
test.each([
  ['named mfa', { status: 'ok', data: 'NextMfa', mfa: CHALLENGE }],
  ['legacy data2', { status: 'ok', data: 'NextMfa', data2: CHALLENGE }],
  ['mfa wins over data2', { status: 'ok', data: 'NextMfa', mfa: CHALLENGE, data2: [{ mfaType: 'email', enabled: true }] }],
])('login → NextMfa maps to a challenge signal and carries the allowed types (%s)', async (_spelling, body) => {
  const calls: Call[] = []
  const client = createAuthClient({ org: TENANT, fetchImpl: mockFetch(body, calls) })
  const res = await client.login({
    identifier: 'davelorenzini@gmail.com',
    password: 'x',
    clientId: 'hanzo-id',
    application: 'hanzo-id',
    organization: 'hanzo',
  })
  assert.equal(res.mfaStage, 'challenge')
  assert.deepEqual(res.mfaTypes, ['app', 'sms'])
})

test('mfaInitiate posts owner/name/mfaType as a JSON BODY', async () => {
  const calls: Call[] = []
  const data = { mfaType: 'app', secret: 'BOUYRUSHJCEDDB33', url: 'otpauth://totp/Hanzo:x?secret=BOUYRUSHJCEDDB33' }
  const client = createAuthClient({ org: TENANT, fetchImpl: mockFetch({ status: 'ok', data }, calls) })
  const setup = await client.mfaInitiate({ owner: 'hanzo', name: 'davelorenzini@gmail.com' })

  assert.equal(setup.secret, 'BOUYRUSHJCEDDB33')
  assert.equal(setup.mfaType, MFA_TOTP)

  assert.equal(new URL(calls[0].url).pathname, '/v1/iam/mfa/setup/initiate')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.credentials, 'include')
  // The BODY, not the query. Query-only with an empty body is what the server
  // answered 400 "invalid body" to, and this test asserted the broken shape as if
  // it were the contract — which is why both suites were green while nobody could
  // enrol.
  const sent = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
  assert.deepEqual(sent, { owner: 'hanzo', name: 'davelorenzini@gmail.com', mfaType: 'app' })
})

test('mfaInitiate sends the named factor, so sms and email can be enrolled', async () => {
  const calls: Call[] = []
  // A delivered factor hands back no material: the code went to the address on the
  // account, so there is nothing to render and nothing to echo back.
  const client = createAuthClient({ org: TENANT, fetchImpl: mockFetch({ status: 'ok', data: { mfaType: 'sms' } }, calls) })
  const setup = await client.mfaInitiate({ owner: 'hanzo', name: 'dave@x', mfaType: 'sms' })
  assert.equal(setup.mfaType, 'sms')
  assert.equal(setup.secret, '')
  const sent = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
  assert.equal(sent.mfaType, 'sms')
})

test('mfaEnable sends the PASSCODE that proves possession', async () => {
  const calls: Call[] = []
  const client = createAuthClient({ org: TENANT, fetchImpl: mockFetch({ status: 'ok', data: { mfaType: 'app', recoveryCodes: ['rc-1', 'rc-2'] } }, calls) })
  const r = await client.mfaEnable({ owner: 'hanzo', name: 'dave@x', secret: 'SEC', passcode: '123456' })

  assert.equal(r.ok, true)
  // Minted by IAM and returned once. The old client sent `recoveryCodes` UP — a
  // string into a []string field, so even a body-shaped request failed to decode —
  // and stored whatever it echoed, which meant a client sending none enrolled a
  // factor with no way back in.
  assert.deepEqual(r.recoveryCodes, ['rc-1', 'rc-2'])

  assert.equal(new URL(calls[0].url).pathname, '/v1/iam/mfa/setup/enable')
  const sent = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
  assert.equal(sent.secret, 'SEC')
  assert.equal(sent.passcode, '123456')
  assert.equal(sent.recoveryCodes, undefined, 'the client must not supply the codes it is meant to be handed')
})

test('mfaEnable surfaces an IAM refusal instead of throwing', async () => {
  const calls: Call[] = []
  const client = createAuthClient({ org: TENANT, fetchImpl: mockFetch({ status: 'error', msg: 'the code is incorrect' }, calls) })
  const r = await client.mfaEnable({ owner: 'hanzo', name: 'dave@x', secret: 'SEC', passcode: '000000' })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'the code is incorrect')
  assert.deepEqual(r.recoveryCodes, [])
})

test('mfaChallenge re-POSTs /v1/iam/login with mfaType/passcode and NO username', async () => {
  const calls: Call[] = []
  // code flow: data is the freshly minted auth code
  const client = createAuthClient({ org: TENANT, fetchImpl: mockFetch({ status: 'ok', data: 'AUTHCODE' }, calls) })
  const res = await client.mfaChallenge({
    mfaType: 'app',
    passcode: '654321',
    clientId: 'hanzo-id',
    application: 'hanzo-id',
    organization: 'hanzo',
    redirectUri: 'https://app.example/cb',
    state: 'st',
  })
  const sent = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
  assert.equal(new URL(calls[0].url).pathname, '/v1/iam/login')
  assert.equal(sent.mfaType, 'app')
  assert.equal(sent.passcode, '654321')
  assert.equal(sent.username, undefined, 'challenge must not send a username')
  assert.equal(calls[0].init.credentials, 'include')
  assert.equal(res.redirectUrl, 'https://app.example/cb?code=AUTHCODE&state=st')
})

test('mfaChannelOf maps IAM types to UI channels', () => {
  assert.equal(mfaChannelOf('app'), 'totp')
  assert.equal(mfaChannelOf('sms'), 'sms')
  assert.equal(mfaChannelOf('email'), 'email')
  assert.equal(mfaChannelOf('anything-else'), 'totp')
})

// --- the second factor for a sign-in that arrived through another provider ---
//
// IAM parks the resume and redirects the browser to /login/mfa; this is the call
// that page makes. Nothing in the portal made it, so the challenge the callback
// set was never redeemed and a 2FA-enrolled person could not finish a Google or
// GitHub sign-in at all.

test('federationMfa posts the factor ALONE, riding the challenge cookie', async () => {
  const calls: Call[] = []
  const client = createAuthClient({
    org: TENANT,
    fetchImpl: mockFetch({ status: 'ok', data: 'https://app.example/cb?code=AUTHCODE&state=st' }, calls),
  })
  const res = await client.federationMfa({ mfaType: MFA_TOTP, passcode: '123456' })

  assert.equal(new URL(calls[0].url).pathname, '/v1/iam/oauth/federation/mfa')
  assert.equal(calls[0].init.method, 'POST')
  // The challenge id is httpOnly, so the credentials must travel.
  assert.equal(calls[0].init.credentials, 'include')
  const sent = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
  assert.deepEqual(sent, { mfaType: 'app', passcode: '123456' })
  // IAM answers with the FINISHED redirect built from the request it pinned — not
  // a code to append, because this browser never held the request.
  assert.equal(res.redirectUrl, 'https://app.example/cb?code=AUTHCODE&state=st')
})

test('federationMfa surfaces a refusal, which IAM sends as HTTP 200', async () => {
  const calls: Call[] = []
  const client = createAuthClient({
    org: TENANT,
    fetchImpl: mockFetch({ status: 'error', msg: 'the multi-factor authentication code is incorrect' }, calls),
  })
  const res = await client.federationMfa({ mfaType: MFA_TOTP, passcode: '000000' })
  assert.equal(res.redirectUrl, undefined, 'a refusal must never navigate')
  assert.equal(res.error, 'the multi-factor authentication code is incorrect')
})

test('federationMfa refuses to navigate on an answer with no destination', async () => {
  const calls: Call[] = []
  const client = createAuthClient({ org: TENANT, fetchImpl: mockFetch({ status: 'ok', data: '' }, calls) })
  const res = await client.federationMfa({ mfaType: MFA_TOTP, passcode: '123456' })
  assert.equal(res.redirectUrl, undefined)
  assert.ok(res.error)
})
