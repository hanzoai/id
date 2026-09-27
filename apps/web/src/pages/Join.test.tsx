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

const JOINED = { status: 'ok', data: { org: 'acme', joined: true } }

const SENT = { status: 'error', code: 'email_code_sent', msg: 'We sent a 6-digit code to ada@example.com. Enter it to join acme.' }
const RECENT = { status: 'error', code: 'email_code_required', msg: 'A code was just sent to ada@example.com. Enter it to join acme.' }

/**
 * IAM as this page meets it: who is signed in, the accept door and registration.
 * `pinned` is an invitation pinned to Ada's address: accept without `emailCode`
 * sends her a code (the second ask inside the resend window sends none), and
 * 000000 is refused as a wrong one.
 */
function iam(opts: { account?: object | null; accept?: object; acceptStatus?: number; pinned?: boolean } = {}) {
  const calls: { method: string; url: string; body: string; type: string | null }[] = []
  let asks = 0
  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString()
    calls.push({ method: init?.method ?? 'GET', url, body: String(init?.body ?? ''), type: new Headers(init?.headers).get('Content-Type') })
    if (url.includes('/v1/iam/account')) {
      return json(opts.account ? { status: 'ok', data: opts.account } : { status: 'error', msg: 'please sign in first' })
    }
    if (url.includes('/v1/iam/invitations/accept')) {
      if (opts.pinned) {
        const body = JSON.parse(String(init?.body)) as { emailCode?: string }
        if (!body.emailCode) return json(asks++ ? RECENT : SENT, 400)
        if (body.emailCode === '000000') return json({ status: 'error', msg: 'that code is incorrect or has expired' }, 400)
      }
      return json(opts.accept ?? JOINED, opts.acceptStatus ?? 200)
    }
    if (url.includes('/v1/iam/signup')) return json({ status: 'ok', data: { id: 'u-2', owner: 'acme', name: 'ada' } })
    if (url.includes('/v1/iam/login')) return json({ status: 'ok', data: '' })
    const app = new URL(url).searchParams.get('clientId') ?? 'hanzo-console'
    return json({ status: 'ok', data: { owner: 'admin', name: app, organization: 'hanzo', enableSignUp: true } })
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

const LINK = '?client_id=hanzo-app&invite=K7QX2M9PLR&org=acme'

test('signed out, both ways in carry the invitation through the app the link names', async () => {
  at(LINK)
  const { calls, fetchImpl } = iam({ account: null })
  render(<Join client={createAuthClient({ org: ORG, fetchImpl })} brand={BRAND} org={ORG} />)
  await waitFor(() => assert.ok(text().includes('You were invited to join acme on Hanzo')))
  const signin = new URL(link('Sign in')!, 'https://hanzo.id')
  assert.equal(signin.pathname, '/login')
  assert.equal(signin.searchParams.get('client_id'), 'hanzo-app')
  assert.equal(signin.searchParams.get('return'), `/join${LINK}`)

  // Registration reads the app the link named and makes the account in the
  // inviting org, on the invitation's code.
  fireEvent.change(document.querySelector('input[type="email"]')!, { target: { value: 'ada@example.com' } })
  fireEvent.change(document.querySelector('input[type="password"]')!, { target: { value: 'correct horse battery staple' } })
  fireEvent.submit(document.querySelector('form')!)
  await waitFor(() => assert.ok(calls.some((c) => c.url.includes('/v1/iam/signup'))))
  assert.ok(calls.some((c) => c.url.includes('/v1/iam/auth/application') && new URL(c.url).searchParams.get('clientId') === 'hanzo-app'))
  const body = JSON.parse(calls.find((c) => c.url.includes('/v1/iam/signup'))!.body) as Record<string, unknown>
  assert.equal(body.organization, 'acme')
  assert.equal(body.invitationCode, 'K7QX2M9PLR')
})

test('a link with no app registers through the host’s own', async () => {
  at('?invite=K7QX2M9PLR&org=acme')
  const { fetchImpl } = iam({ account: null })
  render(<Join client={createAuthClient({ org: ORG, fetchImpl })} brand={BRAND} org={ORG} />)
  await waitFor(() => assert.ok(link('Sign in')))
  const signin = new URL(link('Sign in')!, 'https://hanzo.id')
  assert.equal(signin.searchParams.get('client_id'), null)
  assert.equal(signin.searchParams.get('return'), '/join?invite=K7QX2M9PLR&org=acme')
})

test('signed in, Join accepts as that account and says it joined', async () => {
  at(LINK)
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
  at(LINK)
  const refusal = 'this invitation was sent to a different email address; sign in with the account it was sent to'
  const { fetchImpl } = iam({ account: ADA, accept: { status: 'error', msg: refusal }, acceptStatus: 400 })
  render(<Join client={createAuthClient({ org: ORG, fetchImpl })} brand={BRAND} org={ORG} />)
  await waitFor(() => assert.ok(document.querySelector('form')))
  fireEvent.submit(document.querySelector('form')!)
  await waitFor(() => assert.ok(text().includes(refusal)))
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

// A pinned invitation asks the signed-in account to prove its own address. Accept
// sends the code itself and says where; the page shows that sentence with a Code
// field, asks again for a new code, and joins with the code. It never asks for a
// code on its own.
test('a pinned invitation joins with the code accept sent, and a new code is another ask', async () => {
  at(LINK)
  const { calls, fetchImpl } = iam({ account: ADA, pinned: true })
  render(<Join client={createAuthClient({ org: ORG, fetchImpl })} brand={BRAND} org={ORG} />)
  await waitFor(() => assert.ok(document.querySelector('form')))
  fireEvent.submit(document.querySelector('form')!)

  await waitFor(() => assert.ok(text().includes('We sent a 6-digit code to ada@example.com. Enter it to join acme.')))
  assert.ok(document.querySelector('input[autocomplete="one-time-code"]'))

  // A new code is the same ask again; inside the resend window IAM says one just went.
  fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Send a new code')!)
  await waitFor(() => assert.ok(text().includes('A code was just sent to ada@example.com. Enter it to join acme.')))
  assert.ok(document.querySelector('input[autocomplete="one-time-code"]'))

  fireEvent.change(document.querySelector('input[autocomplete="one-time-code"]')!, { target: { value: '424242' } })
  fireEvent.submit(document.querySelector('form')!)
  await waitFor(() => assert.ok(text().includes('You joined acme')))
  const accepts = calls.filter((c) => c.url.includes('/v1/iam/invitations/accept'))
  assert.deepEqual(
    accepts.map((c) => JSON.parse(c.body)),
    [
      { owner: 'acme', code: 'K7QX2M9PLR' },
      { owner: 'acme', code: 'K7QX2M9PLR' },
      { owner: 'acme', code: 'K7QX2M9PLR', emailCode: '424242' },
    ],
  )
  // The cookie door takes a same-origin JSON request and nothing else.
  assert.ok(accepts.every((c) => c.type === 'application/json'))
  assert.ok(!calls.some((c) => c.url.includes('/v1/iam/verification-codes')), 'the page sends no code of its own')
})

test('a wrong code is IAM’s sentence, and the code step stays', async () => {
  at(LINK)
  const { fetchImpl } = iam({ account: ADA, pinned: true })
  render(<Join client={createAuthClient({ org: ORG, fetchImpl })} brand={BRAND} org={ORG} />)
  await waitFor(() => assert.ok(document.querySelector('form')))
  fireEvent.submit(document.querySelector('form')!)
  await waitFor(() => assert.ok(document.querySelector('input[autocomplete="one-time-code"]')))
  fireEvent.change(document.querySelector('input[autocomplete="one-time-code"]')!, { target: { value: '000000' } })
  fireEvent.submit(document.querySelector('form')!)
  await waitFor(() => assert.ok(text().includes('that code is incorrect or has expired')))
  assert.ok(document.querySelector('input[autocomplete="one-time-code"]'))
  assert.ok(!text().includes('You joined'))
})

for (const [status, msg] of [
  [429, 'too many attempts to join an organization; try again in an hour'],
  [503, 'email codes cannot be sent from here'],
  [502, 'the code could not be sent; try again later'],
] as const) {
  test(`a ${status} is IAM’s own sentence`, async () => {
    at(LINK)
    const { fetchImpl } = iam({ account: ADA, accept: { status: 'error', msg }, acceptStatus: status })
    render(<Join client={createAuthClient({ org: ORG, fetchImpl })} brand={BRAND} org={ORG} />)
    await waitFor(() => assert.ok(document.querySelector('form')))
    fireEvent.submit(document.querySelector('form')!)
    await waitFor(() => assert.ok(text().includes(msg)))
    assert.equal(document.querySelector('input[autocomplete="one-time-code"]'), null)
  })
}
