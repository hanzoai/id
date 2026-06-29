/**
 * MFA wiring tests — pure, no network (fetch is mocked via `fetchImpl`).
 * Run with: pnpm --filter @hanzo/id-auth test
 *
 * Locks the wire contract verified live against iam.hanzo.ai:
 *  - login answers a forced-MFA org with `data:"RequiredMfa"` (enroll) or
 *    `data:"NextMfa"` + `data2` (challenge) — STRINGS, never a boolean.
 *  - the `/v1/iam/mfa/setup/*` calls carry EVERY param on the query string with
 *    an EMPTY body (the one shape IAM's authz self-match + controller accept).
 *  - the challenge re-POSTs `/v1/iam/login` with `{mfaType,passcode}` and NO
 *    username, riding the MFA session cookie.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { TenantConfig } from '@hanzo/id-shared'
import { createAuthClient, mfaChannelOf, MFA_TOTP } from './client.ts'

const TENANT: TenantConfig = {
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
  const client = createAuthClient({ tenant: TENANT, fetchImpl: mockFetch({ status: 'ok', data: 'RequiredMfa' }, calls) })
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

test('login → NextMfa maps to a challenge signal and carries the allowed types', async () => {
  const calls: Call[] = []
  const body = {
    status: 'ok',
    data: 'NextMfa',
    data2: [{ mfaType: 'app', enabled: true }, { mfaType: 'sms', enabled: true }],
  }
  const client = createAuthClient({ tenant: TENANT, fetchImpl: mockFetch(body, calls) })
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

test('mfaInitiate puts owner/name/mfaType on the query string with an empty body', async () => {
  const calls: Call[] = []
  const data = { secret: 'BOUYRUSHJCEDDB33', url: 'otpauth://totp/Hanzo:x?secret=BOUYRUSHJCEDDB33', recoveryCodes: ['rc-1'] }
  const client = createAuthClient({ tenant: TENANT, fetchImpl: mockFetch({ status: 'ok', data }, calls) })
  const setup = await client.mfaInitiate({ owner: 'hanzo', name: 'davelorenzini@gmail.com' })

  assert.equal(setup.secret, 'BOUYRUSHJCEDDB33')
  assert.equal(setup.mfaType, MFA_TOTP)
  assert.deepEqual(setup.recoveryCodes, ['rc-1'])

  const u = new URL(calls[0].url)
  assert.equal(u.pathname, '/v1/iam/mfa/setup/initiate')
  assert.equal(u.searchParams.get('owner'), 'hanzo')
  assert.equal(u.searchParams.get('name'), 'davelorenzini@gmail.com')
  assert.equal(u.searchParams.get('mfaType'), 'app')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.body, undefined, 'body must be empty for authz self-match')
  assert.equal(calls[0].init.credentials, 'include')
})

test('mfaVerify carries owner/name (for authz) + secret + passcode on the query', async () => {
  const calls: Call[] = []
  const client = createAuthClient({ tenant: TENANT, fetchImpl: mockFetch({ status: 'ok', data: 'OK' }, calls) })
  const r = await client.mfaVerify({ owner: 'hanzo', name: 'dave@x', secret: 'SEC', passcode: '123456' })
  assert.equal(r.ok, true)
  const u = new URL(calls[0].url)
  assert.equal(u.pathname, '/v1/iam/mfa/setup/verify')
  assert.equal(u.searchParams.get('owner'), 'hanzo')
  assert.equal(u.searchParams.get('secret'), 'SEC')
  assert.equal(u.searchParams.get('passcode'), '123456')
  assert.equal(u.searchParams.get('mfaType'), 'app')
})

test('mfaVerify surfaces an IAM error instead of throwing', async () => {
  const calls: Call[] = []
  const client = createAuthClient({ tenant: TENANT, fetchImpl: mockFetch({ status: 'error', msg: 'wrong passcode' }, calls) })
  const r = await client.mfaVerify({ owner: 'hanzo', name: 'dave@x', secret: 'SEC', passcode: '000000' })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'wrong passcode')
})

test('mfaEnable echoes the recovery code back on the query', async () => {
  const calls: Call[] = []
  const client = createAuthClient({ tenant: TENANT, fetchImpl: mockFetch({ status: 'ok', data: 'OK' }, calls) })
  const r = await client.mfaEnable({ owner: 'hanzo', name: 'dave@x', secret: 'SEC', recoveryCode: 'rc-1' })
  assert.equal(r.ok, true)
  const u = new URL(calls[0].url)
  assert.equal(u.pathname, '/v1/iam/mfa/setup/enable')
  assert.equal(u.searchParams.get('recoveryCodes'), 'rc-1')
  assert.equal(u.searchParams.get('secret'), 'SEC')
})

test('mfaChallenge re-POSTs /v1/iam/login with mfaType/passcode and NO username', async () => {
  const calls: Call[] = []
  // code flow: data is the freshly minted auth code
  const client = createAuthClient({ tenant: TENANT, fetchImpl: mockFetch({ status: 'ok', data: 'AUTHCODE' }, calls) })
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
