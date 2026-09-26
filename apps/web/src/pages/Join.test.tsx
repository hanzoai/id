/**
 * The page an invite link opens: the one door that fits the person holding it,
 * with the invitation's code carried there and nothing looked up on the way.
 */
import { afterEach, test } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { Brand } from '@hanzo/id-shared'
import { createAuthClient } from '@hanzo/id-auth'
import { Join } from './Join'

afterEach(cleanup)

const ORG = {
  orgId: 'hanzo',
  iamUrl: 'https://hanzo.id',
  iamIssuer: 'https://hanzo.id',
  clientId: 'hanzo-console',
  appName: 'hanzo-console',
  publicOrigin: 'https://hanzo.id',
  brandPackage: '@hanzo/brand',
} as Parameters<typeof createAuthClient>[0]['org']

const BRAND = { name: 'Hanzo', logoUrl: '', faviconUrl: '' } as unknown as Brand

const ADA = { owner: 'ada', name: 'ada', id: 'u-1', displayName: 'Ada Lovelace', email: 'ada@example.com' }

/** IAM as this page meets it: who is signed in, and the accept door. */
function iam(opts: { account?: object | null; accept?: object } = {}) {
  const calls: { method: string; url: string; body: string }[] = []
  const json = (payload: unknown) =>
    new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString()
    calls.push({ method: init?.method ?? 'GET', url, body: String(init?.body ?? '') })
    if (url.includes('/v1/iam/account')) {
      return json(opts.account ? { status: 'ok', data: opts.account } : { status: 'error', msg: 'please sign in first' })
    }
    if (url.includes('/v1/iam/invitations/accept')) return json(opts.accept ?? { org: 'acme', joined: true })
    return json({ status: 'ok', data: { owner: 'admin', name: 'hanzo-console', organization: 'hanzo', enableSignUp: true } })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

function at(search: string) {
  window.history.replaceState({}, '', `/join${search}`)
}

const text = () => document.body.textContent ?? ''
const link = (name: string) => [...document.querySelectorAll('a')].find((a) => a.textContent === name)?.getAttribute('href')

test('a link missing its org or code says so and asks nothing of IAM', async () => {
  for (const search of ['?org=acme', '?invite=K7QX2M9PLR', '']) {
    at(search)
    const { calls, fetchImpl } = iam()
    render(<Join client={createAuthClient({ org: ORG, fetchImpl })} brand={BRAND} org={ORG} />)
    await waitFor(() => assert.ok(text().includes('This invite link is incomplete')))
    assert.deepEqual(calls, [])
    cleanup()
  }
})

test('signed out, both ways in carry the invitation', async () => {
  at('?org=acme&invite=K7QX2M9PLR')
  const { fetchImpl } = iam({ account: null })
  render(<Join client={createAuthClient({ org: ORG, fetchImpl })} brand={BRAND} org={ORG} />)
  await waitFor(() => assert.ok(text().includes('You were invited to join acme on Hanzo')))
  assert.ok(document.querySelector('input[type="email"]'), 'the registration form is on the page')
  const signin = new URL(link('Sign in')!, 'https://hanzo.id')
  assert.equal(signin.pathname, '/login')
  assert.equal(signin.searchParams.get('return'), '/join?org=acme&invite=K7QX2M9PLR')
})

test('signed in, Join accepts as that account and says it joined', async () => {
  at('?org=acme&invite=K7QX2M9PLR')
  const { calls, fetchImpl } = iam({ account: ADA })
  render(<Join client={createAuthClient({ org: ORG, fetchImpl })} brand={BRAND} org={ORG} />)
  await waitFor(() => assert.ok(text().includes('Signed in as Ada Lovelace · ada@example.com')))
  fireEvent.submit(document.querySelector('form')!)
  await waitFor(() => assert.ok(text().includes('You joined acme')))
  const accept = calls.find((c) => c.url.includes('/v1/iam/invitations/accept'))!
  assert.equal(accept.method, 'POST')
  assert.deepEqual(JSON.parse(accept.body), { owner: 'acme', code: 'K7QX2M9PLR' })
  assert.equal(link('Continue'), 'https://hanzo.ai/account/organization')
})

test('a refusal is IAM’s own sentence, and nothing claims a join', async () => {
  at('?org=acme&invite=K7QX2M9PLR')
  const { fetchImpl } = iam({ account: ADA, accept: { status: 'error', msg: 'this invitation is for another address' } })
  render(<Join client={createAuthClient({ org: ORG, fetchImpl })} brand={BRAND} org={ORG} />)
  await waitFor(() => assert.ok(document.querySelector('form')))
  fireEvent.submit(document.querySelector('form')!)
  await waitFor(() => assert.ok(text().includes('this invitation is for another address')))
  assert.ok(!text().includes('You joined'))
})

test('an account made on the invitation is already in the org, and is not offered a second seat', async () => {
  at('?org=acme&invite=K7QX2M9PLR')
  const { calls, fetchImpl } = iam({ account: { ...ADA, owner: 'acme' } })
  render(<Join client={createAuthClient({ org: ORG, fetchImpl })} brand={BRAND} org={ORG} />)
  await waitFor(() => assert.ok(text().includes('You are in acme')))
  assert.equal(document.querySelector('form'), null)
  assert.ok(!calls.some((c) => c.url.includes('/accept')))
})
