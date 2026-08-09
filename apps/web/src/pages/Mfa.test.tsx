/**
 * The page that finishes a sign-in which arrived through another identity
 * provider, mounted for real.
 *
 * IAM redirects a 2FA-enrolled social sign-in to `/login/mfa` and holds the whole
 * resume; nothing in this portal answered, so the challenge was never redeemed and
 * the sign-in could not complete at all. What is under test is the leg that was
 * missing: a code field, one POST carrying the factor ALONE, and the redirect IAM
 * hands back.
 */
import { afterEach, test } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { BrandContract } from '@hanzo/id-shared'
import { createAuthClient } from '@hanzo/id-auth'
import { Mfa } from './Mfa'

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

const BRAND = { name: 'Hanzo', logoUrl: '', faviconUrl: '' } as unknown as BrandContract

type Call = { url: string; init: RequestInit }

/** An IAM double that records what the page sent and answers with `payload`. */
function iam(payload: unknown, calls: Call[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: input.toString(), init: init ?? {} })
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

function code(): HTMLInputElement {
  const el = document.querySelector('input[autocomplete="one-time-code"]')
  assert.ok(el, 'no one-time-code field on the page')
  return el as HTMLInputElement
}

/** Enter a code and press Verify, the way a person does. */
function verify(value: string) {
  fireEvent.change(code(), { target: { value } })
  const submit = document.querySelector<HTMLButtonElement>('button[type=submit]')
  assert.ok(submit, 'no submit button')
  assert.equal(submit!.disabled, false, 'Verify must be live once a full code is typed')
  submit!.click()
}

test('the page asks for a code, and never for a password', () => {
  render(<Mfa client={createAuthClient({ org: ORG, fetchImpl: iam({}, []) })} brand={BRAND} />)
  // Live prod renders the CREDENTIAL form at this address — "Sign in to Hanzo ID",
  // a username and a password — because the route fell through to the /login
  // catch-all. A password is the one thing this step must not ask for: the person
  // has already proven a first factor through their provider.
  assert.equal(document.querySelectorAll('input[type=password]').length, 0)
  assert.equal(document.querySelectorAll('input').length, 1)
  assert.match(document.querySelector('h1')!.textContent!, /two-factor/i)
})

test('submitting posts the factor ALONE, riding the challenge cookie', async () => {
  const calls: Call[] = []
  const client = createAuthClient({
    org: ORG,
    fetchImpl: iam({ status: 'ok', data: 'https://app.example/cb?code=AUTHCODE&state=st' }, calls),
  })
  render(<Mfa client={client} brand={BRAND} />)
  verify('123456')

  await waitFor(() => assert.equal(calls.length, 1))
  assert.equal(new URL(calls[0]!.url).pathname, '/v1/iam/oauth/federation/mfa')
  assert.equal(calls[0]!.init.method, 'POST')
  // The challenge id is httpOnly, so the credentials must travel.
  assert.equal(calls[0]!.init.credentials, 'include')
  // Nothing that could name a different sign-in: IAM pinned the account, the
  // client and the redirect_uri when it parked the resume.
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { mfaType: 'app', passcode: '123456' })
})

test('a refusal is shown, and offers the only way forward', async () => {
  const calls: Call[] = []
  const client = createAuthClient({
    org: ORG,
    fetchImpl: iam({ status: 'error', msg: 'the multi-factor authentication code is incorrect' }, calls),
  })
  render(<Mfa client={client} brand={BRAND} />)
  verify('000000')

  const alert = await waitFor(() => {
    const el = document.querySelector('[role=alert]')
    assert.ok(el)
    return el!
  })
  assert.match(alert.textContent!, /incorrect/)
  // A wrong code SPENDS the challenge (IAM burns it on use), so retyping here
  // cannot work and the page says where to go instead.
  assert.ok(
    [...document.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/login'),
    'a spent challenge must offer starting again',
  )
})

test('an answer with no destination does not navigate', async () => {
  const calls: Call[] = []
  const client = createAuthClient({ org: ORG, fetchImpl: iam({ status: 'ok', data: '' }, calls) })
  render(<Mfa client={client} brand={BRAND} />)
  verify('123456')
  await waitFor(() => assert.ok(document.querySelector('[role=alert]')))
})
