import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createAuthClient } from './client.ts'
import type { Org } from '@hanzo/id-shared'

// The REDEEM half of recovery: `PUT /v1/iam/password`, the one place a person's
// own password is written. Sending a code was already covered; nothing pinned what
// happens to the code afterwards, because until this endpoint existed nothing
// happened to it at all.

function org(overrides: Partial<Org> = {}): Org {
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

/**
 * A fetch double that records what would go ON THE WIRE and answers with a canned
 * IAM envelope.
 *
 * The content type is read off a real `Request` built from the same arguments,
 * because that is where it is DECIDED: a URLSearchParams body makes fetch set
 * `application/x-www-form-urlencoded` itself, so reading the caller's own headers
 * would report an empty string for the very request shape under test.
 */
function recorder(payload: unknown, status = 200) {
  const calls: { url: string; method: string; contentType: string; body: unknown }[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push({
      url,
      method: init?.method ?? 'GET',
      contentType: new Request(url, init).headers.get('content-type') ?? '',
      body: init?.body,
    })
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return { calls, fetchImpl }
}

// THE OTHER HALF. Recovery needs an endpoint that redeems the code into a
// password; there was none, so the code was minted, delivered and unusable.
test('setPassword redeems a code against the address it was sent to', async () => {
  const { calls, fetchImpl } = recorder({ status: 'ok' })
  const client = createAuthClient({ org: org(), fetchImpl })

  const res = await client.setPassword({
    identifier: 'z@hanzo.ai',
    organization: 'hanzo',
    code: '424242',
    password: 'correct horse battery staple',
  })
  assert.equal(res.ok, true)

  const call = calls[0]!
  assert.equal(call.url, 'https://hanzo.id/v1/iam/password')
  assert.equal(call.method, 'PUT')
  const body = JSON.parse(String(call.body)) as Record<string, unknown>
  assert.equal(body.username, 'z@hanzo.ai', 'the code is redeemed against the address it was minted for')
  assert.equal(body.organization, 'hanzo')
  assert.equal(body.code, '424242')
  assert.equal(body.password, 'correct horse battery staple')
  assert.equal('oldPassword' in body, false, 'one proof per request')
})

// A signed-in rotation names NOBODY: IAM takes the subject from the session this
// call carries, and a body that named an account would be the shape in which one
// person writes another's credential.
test('setPassword rotates with the old password and names no account', async () => {
  const { calls, fetchImpl } = recorder({ status: 'ok' })
  const client = createAuthClient({ org: org(), fetchImpl })

  await client.setPassword({ oldPassword: 'old one', password: 'new correct horse' })

  const body = JSON.parse(String(calls[0]!.body)) as Record<string, unknown>
  assert.equal(body.oldPassword, 'old one')
  assert.equal(body.password, 'new correct horse')
  assert.equal('username' in body, false)
  assert.equal('organization' in body, false)
  assert.equal('code' in body, false)
})

// The refusal a wrong code earns is the server's one opaque sentence, surfaced
// verbatim so the screen can say something true.
test('setPassword surfaces the IAM refusal', async () => {
  const { fetchImpl } = recorder({ status: 'error', msg: 'the code is incorrect or has expired' }, 400)
  const client = createAuthClient({ org: org(), fetchImpl })
  const res = await client.setPassword({
    identifier: 'z@hanzo.ai', organization: 'hanzo', code: '000000', password: 'new correct horse',
  })
  assert.equal(res.ok, false)
  assert.equal(res.error, 'the code is incorrect or has expired')
})
