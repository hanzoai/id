import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createAuthClient } from './client.ts'
import type { OrgConfig } from '@hanzo/id-shared'

// THE BROWSER'S IDENTITY SET, from the client's side.
//
// `identities()` reads it, `useIdentity()` selects among it, and `logout()`
// narrows a sign-out to one of them. All three are the CLI's verbs — list, use,
// logout — talking to the same issuer, so these tests assert the WIRE: which URL
// is called, what travels in the body, and what never does.

function idOrg(overrides: Partial<OrgConfig> = {}): OrgConfig {
  return {
    orgId: 'hanzo',
    iamUrl: 'https://hanzo.id',
    iamIssuer: 'https://hanzo.id',
    clientId: 'hanzo-console',
    appName: 'hanzo-console',
    publicOrigin: 'https://hanzo.id',
    oauthCallbackOrigin: 'https://hanzo.id',
    brandPackage: '@hanzo/brand',
    ...overrides,
  } as OrgConfig
}

function recorder(payload: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: typeof input === 'string' ? input : input.toString(), init })
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return { calls, fetchImpl }
}

test('identities() reads the browser-scoped list and marks the active one', async () => {
  const { calls, fetchImpl } = recorder({
    status: 'ok',
    active: 'hanzo/a',
    data: [
      { identity: 'hanzo/z', owner: 'hanzo', name: 'z', sub: 's-z', email: 'z@hanzo.ai' },
      { identity: 'hanzo/a', owner: 'hanzo', name: 'a', sub: 's-a', email: 'a@hanzo.ai', active: true },
    ],
  })
  const client = createAuthClient({ org: idOrg(), fetchImpl })

  const held = await client.identities()

  assert.equal(calls[0]!.url, 'https://hanzo.id/v1/iam/identities')
  // Scoped to this browser's cookie and nothing else: no parameters to point it
  // at anyone, and the cookie must actually be sent.
  assert.equal(calls[0]!.init?.credentials, 'include')
  assert.equal(held.identities.length, 2)
  assert.equal(held.active, 'hanzo/a')
  assert.equal(held.identities.find((i) => i.active)?.identity, 'hanzo/a')
})

test('identities() answers an empty set when nobody is signed in — never an error', async () => {
  const { fetchImpl } = recorder({ status: 'ok', data: [] })
  const client = createAuthClient({ org: idOrg(), fetchImpl })

  const held = await client.identities()

  assert.deepEqual(held, { identities: [], active: '' })
})

test('identities() answers an empty set when the issuer is unreachable', async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error('network down')
  }
  const client = createAuthClient({ org: idOrg(), fetchImpl })

  // A browser that cannot reach the issuer holds no identity it can prove.
  assert.deepEqual(await client.identities(), { identities: [], active: '' })
})

test('useIdentity() sends the selector and NO credential', async () => {
  const { calls, fetchImpl } = recorder({ status: 'ok', data: 'hanzo/z' })
  const client = createAuthClient({ org: idOrg(), fetchImpl })

  await client.useIdentity({ identity: 'hanzo/z', application: 'hanzo-console' })

  const sent = JSON.parse(String(calls[0]!.init?.body))
  assert.equal(calls[0]!.url.split('?')[0], 'https://hanzo.id/v1/iam/login')
  assert.equal(sent.identity, 'hanzo/z')
  assert.equal(sent.type, 'login')
  // The session cookie IS the credential. Nothing that looks like one may ride
  // along — the issuer refuses a request carrying both rather than ranking them.
  assert.equal(sent.password, undefined)
  assert.equal(sent.username, undefined)
  assert.equal(calls[0]!.init?.credentials, 'include')
})

test('useIdentity() with an OAuth request in flight asks for a code, PKCE bound', async () => {
  const { calls, fetchImpl } = recorder({ status: 'ok', data: 'AUTHCODE' })
  const client = createAuthClient({ org: idOrg(), fetchImpl })

  const res = await client.useIdentity({
    identity: 'hanzo/a',
    application: 'second',
    clientId: 'second',
    redirectUri: 'https://second.example/callback',
    state: 'st-42',
    codeChallenge: 'CHALLENGE',
  })

  const url = new URL(calls[0]!.url)
  const sent = JSON.parse(String(calls[0]!.init?.body))
  assert.equal(sent.type, 'code')
  assert.equal(sent.identity, 'hanzo/a')
  assert.equal(url.searchParams.get('clientId'), 'second')
  assert.equal(url.searchParams.get('redirectUri'), 'https://second.example/callback')
  assert.equal(url.searchParams.get('code_challenge'), 'CHALLENGE')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  // The answer lands the browser back on the app's own callback with the code.
  assert.ok(res.redirectUrl?.startsWith('https://second.example/callback'))
  assert.ok(res.redirectUrl?.includes('code=AUTHCODE'))
})

test('logout() names an identity only when asked; a bare logout names none', () => {
  const client = createAuthClient({ org: idOrg(), fetchImpl: recorder({}).fetchImpl })

  const one = new URL(client.logout(undefined, 'https://hanzo.id/', 'hanzo/a'))
  assert.equal(one.searchParams.get('logout_hint'), 'hanzo/a')

  // No hint means no qualifier, which the issuer reads as "every identity" —
  // the safe default a shared machine needs.
  const all = new URL(client.logout())
  assert.equal(all.searchParams.get('logout_hint'), null)
  assert.equal(all.searchParams.get('id_token_hint'), null)
})
