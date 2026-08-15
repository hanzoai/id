import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createAccountClient } from './account.ts'
import type { OrgConfig } from '@hanzo/id-shared'

// The self-service half of IAM: what a person may read and change about their own
// account. Each test below pins a property that is invisible from the call site
// and expensive to get wrong — a refusal that arrives wearing HTTP 200, a list
// that is scoped to the ORG rather than to the person, and a tri-state that has a
// real "not answered" value distinct from "no".

function org(overrides: Partial<OrgConfig> = {}): OrgConfig {
  return {
    orgId: 'hanzo',
    iamUrl: 'https://hanzo.id',
    iamIssuer: 'https://hanzo.id',
    clientId: 'hanzo-id',
    appName: 'hanzo-id',
    publicOrigin: 'https://hanzo.id',
    brandPackage: '@hanzo/brand',
    ...overrides,
  }
}

/** Answers each URL from a table, recording what went out. */
function wire(routes: Record<string, { body: unknown; status?: number }>) {
  const calls: { url: string; method: string; body: unknown }[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    const path = new URL(url).pathname + new URL(url).search
    const hit = routes[path] ?? routes[new URL(url).pathname]
    if (!hit) throw new Error(`no route for ${path}`)
    return new Response(JSON.stringify(hit.body), {
      status: hit.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { calls, fetchImpl }
}

const ROW = { owner: 'hanzo', name: 'z', id: 'u-1', displayName: 'Z', email: 'z@hanzo.ai' }

test('a refusal that arrives as HTTP 200 is still a refusal', async () => {
  // IAM answers "please sign in first" with a 200 and an error envelope. Reading
  // `res.ok` alone reports that as a signed-in account with every field blank,
  // which renders an account page for nobody.
  const { fetchImpl } = wire({ '/v1/iam/account': { body: { status: 'error', msg: 'please sign in first' } } })
  const c = createAccountClient({ org: org(), fetchImpl })
  assert.equal(await c.read(), null)
})

test('read projects the masked row', async () => {
  const { fetchImpl } = wire({ '/v1/iam/account': { body: { status: 'ok', data: ROW } } })
  const c = createAccountClient({ org: org(), fetchImpl })
  const me = await c.read()
  assert.equal(me?.owner, 'hanzo')
  assert.equal(me?.name, 'z')
  assert.equal(me?.email, 'z@hanzo.ai')
  // Absent fields are empty strings, never undefined — the row is a total shape,
  // so a screen never has to guard every single field.
  assert.equal(me?.bio, '')
  assert.equal(me?.emailVerified, false)
})

test('passkeys are filtered to the caller, because IAM scopes them to the ORG', async () => {
  // `GET /v1/iam/webauthn-credentials` pins `owner` to the principal's ORG, so a
  // colleague's key comes back in the same list. Showing it would turn an account
  // page into a directory of everyone's authenticators.
  const { fetchImpl } = wire({
    '/v1/iam/account': { body: { status: 'ok', data: ROW } },
    '/v1/iam/webauthn-credentials': {
      body: {
        status: 'ok',
        data: {
          webauthnCredentials: [
            { name: 'mine', user: 'hanzo/z', attachment: 'platform', transport: ['internal'] },
            { name: 'theirs', user: 'hanzo/someone-else', attachment: 'cross-platform' },
          ],
        },
      },
    },
  })
  const c = createAccountClient({ org: org(), fetchImpl, getToken: async () => 'tok' })
  const keys = await c.passkeys()
  assert.deepEqual(
    keys.map((k) => k.name),
    ['mine'],
  )
})

test('consent is a tri-state: unanswered is not the same as declined', async () => {
  const { fetchImpl } = wire({ '/v1/iam/consent': { body: { status: 'ok', data: { training: '', insights: true } } } })
  const c = createAccountClient({ org: org(), fetchImpl })
  const answer = await c.consent()
  assert.equal(answer.training, null, 'an unanswered question must not read as a refusal')
  assert.equal(answer.insights, true)
})

test('saving one consent answer does not send the other', async () => {
  // Every field is optional on the wire and absent means UNTOUCHED, so answering
  // one question must not carry a stale value for the other one along with it.
  const { calls, fetchImpl } = wire({ '/v1/iam/consent': { body: { status: 'ok' } } })
  const c = createAccountClient({ org: org(), fetchImpl })
  await c.saveConsent({ training: true })
  assert.equal(calls[0].method, 'PUT')
  assert.deepEqual(calls[0].body, { training: 'granted' })
})

test('no self-service call names a target user', async () => {
  // The subject comes from the session on every one of these doors. A body field
  // naming a user is the shape that lets one account edit another.
  const { calls, fetchImpl } = wire({
    '/v1/iam/account': { body: { status: 'ok', data: ROW } },
    '/v1/iam/consent': { body: { status: 'ok' } },
    '/v1/iam/unlink': { body: { status: 'ok' } },
  })
  const c = createAccountClient({ org: org(), fetchImpl })
  await c.saveConsent({ insights: false })
  await c.unlink('github')
  for (const call of calls) {
    const body = (call.body ?? {}) as Record<string, unknown>
    assert.ok(!('owner' in body), `${call.url} must not name an owner`)
    assert.ok(!('username' in body), `${call.url} must not name a username`)
    assert.ok(!('user' in body), `${call.url} must not name a user`)
  }
})

test('memberships are asked for by the caller key and parsed with a role', async () => {
  const { calls, fetchImpl } = wire({
    '/v1/iam/memberships?user=hanzo%2Fz': {
      body: { status: 'ok', data: [{ org: 'hanzo', role: 'admin' }, { org: 'acme' }] },
    },
  })
  const c = createAccountClient({ org: org(), fetchImpl, getToken: async () => 'tok' })
  const mine = await c.memberships('hanzo/z')
  assert.ok(calls[0].url.includes('user=hanzo%2Fz'))
  assert.deepEqual(mine, [
    { org: 'hanzo', role: 'admin' },
    // A row IAM returns without one is a member, not a blank badge.
    { org: 'acme', role: 'member' },
  ])
})

test('an error envelope surfaces IAM sentence, not a status code', async () => {
  const { fetchImpl } = wire({
    '/v1/iam/consent': { body: { status: 'error', msg: 'the application does not allow this' }, status: 200 },
  })
  const c = createAccountClient({ org: org(), fetchImpl })
  await assert.rejects(() => c.saveConsent({ training: true }), /does not allow/)
})

test('a Guarded read without a token says so, instead of showing a bare 401', async () => {
  // IAM's Guard reads a BEARER and has no cookie path, so a portal sign-in — which
  // mints only the session cookie — gets 401 on these two. "Unauthorized" shown to
  // somebody who is plainly signed in is the least useful true sentence available.
  const { calls, fetchImpl } = wire({ '/v1/iam/webauthn-credentials': { body: { status: 'ok' } } })
  const c = createAccountClient({ org: org(), fetchImpl })
  await assert.rejects(() => c.memberships('hanzo/z'), /Sign in again/)
  assert.equal(calls.length, 0, 'and it must not spend a request to find out')
})

test('a token, when there is one, rides as a bearer', async () => {
  const { calls, fetchImpl } = wire({ '/v1/iam/account': { body: { status: 'ok', data: ROW } } })
  const seen: string[] = []
  const spy: typeof fetch = async (input, init) => {
    seen.push(String((init?.headers as Record<string, string>)?.Authorization ?? ''))
    return fetchImpl(input, init)
  }
  const c = createAccountClient({ org: org(), fetchImpl: spy, getToken: async () => 'tok' })
  await c.read()
  assert.deepEqual(seen, ['Bearer tok'])
  assert.equal(calls.length, 1)
})
