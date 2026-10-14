/**
 * The "Confirm your email" step, mounted for real.
 *
 * IAM holds every sign-in of an account whose address was never proven. The step
 * either finishes that sign-in — handing the page the answer the sign-in itself
 * would have given — or stays usable for the next try. What is under test is
 * which of the two each IAM answer leads to, and that every post carries the held
 * sign-in's own request and no credential.
 */
import { afterEach, test } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { Org } from '@hanzo/id-shared'
import { createAuthClient } from '../client'
import type { EmailChallenge, LoginResponse } from '../types'
import { EmailConfirmForm } from './EmailConfirmForm'

afterEach(cleanup)

function org(): Org {
  return {
    orgId: 'hanzo',
    iamUrl: 'https://hanzo.id',
    iamIssuer: 'https://hanzo.id',
    clientId: 'hanzo-console',
    appName: 'hanzo-console',
    publicOrigin: 'https://hanzo.id',
    brandPackage: '@hanzo/brand',
  } as Org
}

const PARAMS = {
  clientId: 'hanzo-cloud',
  application: 'hanzo-cloud',
  organization: 'hanzo',
  redirectUri: 'https://console.hanzo.ai/auth/callback',
  state: 'st',
}

/**
 * An IAM double for the held sign-in: each post to /v1/iam/login takes the next
 * answer in `answers`, and every post is recorded.
 */
function iam(answers: unknown[]) {
  const posts: { url: URL; body: Record<string, unknown>; credentials?: RequestCredentials }[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    posts.push({ url: new URL(input.toString()), body: JSON.parse(String(init?.body)), credentials: init?.credentials })
    const payload = answers[Math.min(posts.length, answers.length) - 1]
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
  return { posts, client: createAuthClient({ org: org(), fetchImpl }) }
}

/** Mount the step for `email`, recording what it hands the page. */
function mount(answers: unknown[], email = 'ada@example.com') {
  const { posts, client } = iam(answers)
  const answered: LoginResponse[] = []
  const expired: string[] = []
  const challenge: EmailChallenge = { email, params: PARAMS }
  render(
    <EmailConfirmForm
      client={client}
      challenge={challenge}
      onAnswer={(res) => void answered.push(res)}
      onExpired={(message) => void expired.push(message)}
    />,
  )
  return { posts, answered, expired }
}

/** The input a visible label names. */
function field(label: string): HTMLInputElement | null {
  const l = [...document.querySelectorAll('label')].find((x) => x.textContent?.trim().startsWith(label))
  return (l?.querySelector('input') as HTMLInputElement | null) ?? null
}

const button = (text: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined

function type(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } })
}

function submit() {
  fireEvent.submit(document.querySelector('form')!)
}

const text = () => document.body.textContent ?? ''

const EXPIRED = 'the sign-in has expired; sign in again'

test('the step names the address and asks for its code', () => {
  mount([])
  assert.equal(document.querySelector('h1')?.textContent, 'Confirm your email')
  assert.match(text(), /We sent a 6-digit code to ada@example\.com\./)
  const code = field('Code')!
  assert.equal(code.getAttribute('autocomplete'), 'one-time-code')
  assert.equal(code.getAttribute('inputmode'), 'numeric')
  assert.equal(code.getAttribute('maxlength'), '6')
  type(code, '4a2-42 42 9')
  assert.equal(code.value, '424242', 'digits only, six of them')
  assert.equal(button('Confirm')?.getAttribute('type'), 'submit')
  assert.ok(button('Send a new code'))
  assert.ok(button('Use a different email'))
})

test('confirming the code hands the page the sign-in\'s own answer', async () => {
  const { posts, answered } = mount([{ status: 'ok', data: 'AUTHCODE' }])
  type(field('Code')!, '424242')
  submit()

  await waitFor(() => assert.equal(answered.length, 1))
  assert.equal(answered[0]!.redirectUrl, 'https://console.hanzo.ai/auth/callback?code=AUTHCODE&state=st')
  assert.equal(posts.length, 1)
  assert.equal(posts[0]!.url.pathname, '/v1/iam/login')
  assert.equal(posts[0]!.credentials, 'include')
  assert.equal(posts[0]!.url.searchParams.get('clientId'), 'hanzo-cloud')
  assert.equal(posts[0]!.url.searchParams.get('redirectUri'), 'https://console.hanzo.ai/auth/callback')
  assert.deepEqual(posts[0]!.body, { type: 'code', application: 'hanzo-cloud', organization: 'hanzo', passcode: '424242' })
})

test('a confirmed address that owes a second factor goes to the page as that answer', async () => {
  const { answered } = mount([{ status: 'ok', data: 'NextMfa', mfa: [{ mfaType: 'app' }] }])
  type(field('Code')!, '424242')
  submit()
  await waitFor(() => assert.equal(answered.length, 1))
  assert.equal(answered[0]!.mfaStage, 'challenge')
})

test('a wrong code is shown, and the step takes another', async () => {
  const { posts, answered } = mount([
    { status: 'error', msg: 'the code is incorrect or has expired' },
    { status: 'ok', data: 'AUTHCODE' },
  ])
  type(field('Code')!, '000000')
  submit()

  await waitFor(() => assert.equal(document.querySelector('[role="alert"]')?.textContent, 'the code is incorrect or has expired'))
  assert.deepEqual(answered, [], 'a refused code is not a sign-in')
  assert.ok(field('Code'), 'the code field stays for the next try')
  assert.equal(field('Code')!.getAttribute('aria-invalid'), 'true')

  type(field('Code')!, '424242')
  submit()
  await waitFor(() => assert.equal(answered.length, 1))
  assert.equal(posts[1]!.body.passcode, '424242')
})

test('an incomplete code is refused before it reaches IAM', async () => {
  const { posts } = mount([{ status: 'ok', data: 'AUTHCODE' }])
  type(field('Code')!, '424')
  assert.equal(button('Confirm')!.getAttribute('aria-disabled'), 'true')
  submit()
  await new Promise((r) => setTimeout(r, 20))
  assert.deepEqual(posts, [])
})

test('a different address gets its own code, and the step names it', async () => {
  const { posts, answered } = mount([{ status: 'ok', data: 'RequiredEmail', data2: { email: 'grace@example.com' } }])
  button('Use a different email')!.click()

  await waitFor(() => assert.ok(field('Email')))
  assert.equal(field('Code'), null)
  type(field('Email')!, 'grace@example.com')
  submit()

  await waitFor(() => assert.match(text(), /We sent a 6-digit code to grace@example\.com\./))
  assert.ok(field('Code'), 'the new address is confirmed with its own code')
  assert.deepEqual(posts[0]!.body, { type: 'code', application: 'hanzo-cloud', organization: 'hanzo', email: 'grace@example.com' })
  assert.deepEqual(answered, [], 'a new address is not a sign-in')
})

test('choosing a different address by mistake strands nobody', async () => {
  mount([])
  button('Use a different email')!.click()
  await waitFor(() => assert.ok(button('Enter the code sent to ada@example.com')))
  button('Enter the code sent to ada@example.com')!.click()
  await waitFor(() => assert.ok(field('Code')))
})

test('an address IAM refuses is its sentence, and the address field stays', async () => {
  mount([{ status: 'error', msg: 'email already exists' }])
  button('Use a different email')!.click()
  await waitFor(() => assert.ok(field('Email')))
  type(field('Email')!, 'taken@example.com')
  submit()

  await waitFor(() => assert.equal(document.querySelector('[role="alert"]')?.textContent, 'email already exists'))
  assert.ok(field('Email'))
})

test('a new code goes to the address shown, and the step says so', async () => {
  const { posts } = mount([{ status: 'ok', data: 'RequiredEmail', data2: { email: 'ada@example.com' } }])
  button('Send a new code')!.click()

  await waitFor(() => assert.match(text(), /We sent a new code to ada@example\.com\./))
  assert.equal(posts[0]!.body.email, 'ada@example.com')
  assert.equal('passcode' in posts[0]!.body, false)
})

test('with no address on file the step asks for one first', () => {
  mount([], '')
  assert.equal(document.querySelector('h1')?.textContent, 'Confirm your email')
  assert.ok(field('Email'), 'the address comes first')
  assert.equal(field('Code'), null, 'there is no code to type: nothing was sent')
  assert.match(text(), /confirmed email address is required to sign in/)
  assert.equal(button('Enter the code sent to'), undefined, 'no code was sent anywhere')
})

test('an expired hold goes back to the sign-in, with IAM\'s sentence', async () => {
  const { answered, expired } = mount([{ status: 'error', msg: EXPIRED }])
  type(field('Code')!, '424242')
  submit()
  await waitFor(() => assert.deepEqual(expired, [EXPIRED]))
  assert.deepEqual(answered, [])
})
