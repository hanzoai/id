/**
 * Confirm-your-email wiring tests — pure, no network (fetch is mocked via `fetchImpl`).
 *
 * Locks the IAM contract for a sign-in held until the account's address is proven:
 *  - any sign-in post may answer `data:"RequiredEmail"` with `data2.email`, the
 *    address a code went to — `""` when none is on file and nothing was sent;
 *  - the held sign-in carries its own parameters out, and never its credential;
 *  - confirming and sending a code re-POST `/v1/iam/login` with those SAME
 *    parameters, `{passcode}` or `{email}`, NO username and NO password, riding
 *    the challenge cookie;
 *  - a confirmed address answers whatever the sign-in itself would have.
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import type { Org } from '@hanzo/id-shared'
import { createAuthClient } from './client.ts'
import type { LoginParams } from './types.ts'

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

/** An app's sign-in request, as the hosted page carries it. */
const PARAMS: LoginParams = {
  clientId: 'hanzo-cloud',
  application: 'hanzo-cloud',
  organization: 'hanzo',
  redirectUri: 'https://console.hanzo.ai/auth/callback',
  state: 'st',
  nonce: 'n-1',
  codeChallenge: 'AgX39Cb83kllF6GA7XywQjfcBY8fJhLFTbT_dIbqR2c',
  codeChallengeMethod: 'S256',
}

const HELD = { status: 'ok', data: 'RequiredEmail', data2: { email: 'ada@example.com' } }

test('login → RequiredEmail is a hold naming the address, never a redirect', async () => {
  const calls: Call[] = []
  const client = createAuthClient({ org: TENANT, fetchImpl: mockFetch(HELD, calls) })
  const res = await client.login({ identifier: 'ada', password: 'correct horse battery staple', ...PARAMS })

  assert.equal(res.redirectUrl, undefined, 'nothing is signed in until the address is proven')
  assert.equal(res.mfaRequired, undefined)
  assert.equal(res.emailRequired?.email, 'ada@example.com')
  // The request the sign-in carried, so the step that finishes it sends the same one.
  assert.deepEqual(res.emailRequired?.params, PARAMS)
  // And nothing else of the post: the hold lives in page state, so the
  // credential must not ride along with it.
  const held = JSON.stringify(res.emailRequired)
  assert.doesNotMatch(held, /correct horse/)
  assert.equal('identifier' in res.emailRequired!.params, false)
  assert.equal('password' in res.emailRequired!.params, false)
})

test('RequiredEmail with no address on file holds with an empty address', async () => {
  const calls: Call[] = []
  const client = createAuthClient({
    org: TENANT,
    fetchImpl: mockFetch({ status: 'ok', data: 'RequiredEmail', data2: { email: '' } }, calls),
  })
  const res = await client.login({ identifier: 'ada', code: '123456', ...PARAMS })
  assert.equal(res.emailRequired?.email, '')
})

test('emailConfirm re-POSTs /v1/iam/login with the passcode and the SAME request, NO username', async () => {
  const calls: Call[] = []
  // The code flow: a confirmed address answers with the minted auth code.
  const client = createAuthClient({ org: TENANT, fetchImpl: mockFetch({ status: 'ok', data: 'AUTHCODE' }, calls) })
  const res = await client.emailConfirm({ ...PARAMS, passcode: '424242' })

  const url = new URL(calls[0]!.url)
  assert.equal(url.pathname, '/v1/iam/login')
  assert.equal(calls[0]!.init.method, 'POST')
  // The held sign-in is the httpOnly challenge cookie, so the credentials travel.
  assert.equal(calls[0]!.init.credentials, 'include')
  // The OAuth request rides the query, exactly as the sign-in it finishes did.
  assert.equal(url.searchParams.get('clientId'), 'hanzo-cloud')
  assert.equal(url.searchParams.get('redirectUri'), 'https://console.hanzo.ai/auth/callback')
  assert.equal(url.searchParams.get('state'), 'st')
  assert.equal(url.searchParams.get('nonce'), 'n-1')
  assert.equal(url.searchParams.get('code_challenge'), PARAMS.codeChallenge)
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('scope'), 'openid profile email')
  assert.equal(url.searchParams.get('type'), 'code')
  const sent = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>
  assert.deepEqual(sent, { type: 'code', application: 'hanzo-cloud', organization: 'hanzo', passcode: '424242' })
  assert.equal(res.redirectUrl, 'https://console.hanzo.ai/auth/callback?code=AUTHCODE&state=st')
})

test('a bare portal sign-in confirms as type=login and lands where any bare sign-in lands', async () => {
  const calls: Call[] = []
  const client = createAuthClient({ org: TENANT, fetchImpl: mockFetch({ status: 'ok', data: '' }, calls) })
  const res = await client.emailConfirm({ clientId: 'hanzo-id', application: 'hanzo-id', passcode: '424242' })

  const url = new URL(calls[0]!.url)
  assert.equal(url.searchParams.get('type'), 'login')
  assert.equal(url.searchParams.get('redirectUri'), null)
  const sent = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>
  // No organization was carried, so none is invented.
  assert.deepEqual(sent, { type: 'login', application: 'hanzo-id', passcode: '424242' })
  assert.equal(res.redirectUrl, '/onboarding')
})

test('a confirmed address can still owe a second factor', async () => {
  const calls: Call[] = []
  const client = createAuthClient({
    org: TENANT,
    fetchImpl: mockFetch({ status: 'ok', data: 'NextMfa', mfa: [{ mfaType: 'app', enabled: true }] }, calls),
  })
  const res = await client.emailConfirm({ ...PARAMS, passcode: '424242' })
  assert.equal(res.mfaStage, 'challenge')
  assert.deepEqual(res.mfaTypes, ['app'])
  assert.equal(res.redirectUrl, undefined)
})

test('a wrong code is IAM\'s sentence, and nothing navigates', async () => {
  const calls: Call[] = []
  const client = createAuthClient({
    org: TENANT,
    fetchImpl: mockFetch({ status: 'error', msg: 'the code is incorrect or has expired' }, calls),
  })
  const res = await client.emailConfirm({ ...PARAMS, passcode: '000000' })
  assert.equal(res.error, 'the code is incorrect or has expired')
  assert.equal(res.redirectUrl, undefined)
})

test('emailSend posts the address and no passcode, and IAM holds again naming it', async () => {
  const calls: Call[] = []
  const client = createAuthClient({
    org: TENANT,
    fetchImpl: mockFetch({ status: 'ok', data: 'RequiredEmail', data2: { email: 'grace@example.com' } }, calls),
  })
  const res = await client.emailSend({ ...PARAMS, email: 'grace@example.com' })

  assert.equal(new URL(calls[0]!.url).pathname, '/v1/iam/login')
  assert.equal(calls[0]!.init.credentials, 'include')
  const sent = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>
  assert.deepEqual(sent, { type: 'code', application: 'hanzo-cloud', organization: 'hanzo', email: 'grace@example.com' })
  assert.equal(res.emailRequired?.email, 'grace@example.com')
  assert.deepEqual(res.emailRequired?.params, PARAMS, 'the next post carries the same request again')
})

test('a refused address is IAM\'s sentence', async () => {
  const calls: Call[] = []
  const client = createAuthClient({
    org: TENANT,
    fetchImpl: mockFetch({ status: 'error', msg: 'this email provider is not accepted; use a permanent address' }, calls),
  })
  const res = await client.emailSend({ ...PARAMS, email: 'x@mailinator.com' })
  assert.equal(res.error, 'this email provider is not accepted; use a permanent address')
  assert.equal(res.emailRequired, undefined)
})
