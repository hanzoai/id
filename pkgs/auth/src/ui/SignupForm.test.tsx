/**
 * Registration proves the address before the account exists.
 *
 * IAM records an address proven only where it watched the address receive a code,
 * and a password signup is the one moment the person proving it is certainly the
 * person choosing the password. A signup that skips it leaves the account unproven
 * for good, and cloud refuses the git path to an unproven address.
 */
import { afterEach, test } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { Org } from '@hanzo/id-shared'
import { createAuthClient } from '../client'
import { SignupForm } from './SignupForm'

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

/**
 * An IAM double: the descriptor, the code send, the create and the sign-in after
 * it. `code` is the descriptor's switch for "a code can be delivered here", and
 * the create asks for the code under the same switch, as IAM does. `taken` says
 * when an address that already has an account is reported: on the first submit
 * (`first`), or only once a code is brought (`code`, the order IAM used before).
 */
function iam(opts: { code: boolean; send?: unknown; taken?: 'first' | 'code' }) {
  const calls: { method: string; url: string; body: string }[] = []
  let created = 0
  const json = (payload: unknown) =>
    new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString()
    const method = init?.method ?? 'GET'
    if (method !== 'GET') calls.push({ method, url, body: String(init?.body ?? '') })
    if (url.includes('/verification-codes')) return json(opts.send ?? { status: 'ok' })
    if (url.includes('/v1/iam/signup')) {
      const code = 'code' in (JSON.parse(String(init?.body)) as Record<string, unknown>)
      if (opts.taken === 'first' || (opts.taken === 'code' && code)) return json({ status: 'error', msg: 'email already exists' })
      if (opts.code && !code) return json({ status: 'error', msg: 'the code sent to the email address is required' })
      created++
      return json({ status: 'ok', data: { id: 'sub-1', owner: 'ada', name: 'ada' } })
    }
    if (url.includes('/v1/iam/login')) return json({ status: 'ok', data: 'AUTHCODE' })
    return json({
      status: 'ok',
      data: {
        owner: 'admin',
        name: 'hanzo-console',
        organization: 'hanzo',
        enablePassword: true,
        enableSignUp: true,
        enableCodeSignin: opts.code,
        providers: [],
      },
    })
  }) as unknown as typeof fetch
  return { calls, fetchImpl, created: () => created }
}

/** The input a visible label names — wrapped, or associated by `for`. */
function field(label: string): HTMLInputElement | null {
  const l = [...document.querySelectorAll('label')].find((x) => x.textContent?.trim().startsWith(label))
  if (!l) return null
  const inner = l.querySelector('input')
  if (inner) return inner as HTMLInputElement
  const id = l.getAttribute('for')
  return id ? (document.getElementById(id) as HTMLInputElement | null) : null
}

function submit() {
  fireEvent.submit(document.querySelector('form')!)
}

function fill() {
  fireEvent.change(field('Email')!, { target: { value: 'ada@example.com' } })
  fireEvent.change(field('Password')!, { target: { value: 'correct horse battery staple' } })
}

// THE PATH. The code goes to the address first, and the account is created only
// with it — so it is created with the address proven.
test('the address receives a code, and the account is created with it', async () => {
  const { calls, fetchImpl, created } = iam({ code: true })
  render(<SignupForm client={createAuthClient({ org: org(), fetchImpl })} redirectUri="https://console.hanzo.ai/callback" />)

  fill()
  submit()

  await waitFor(() => assert.ok(field('Code'), 'the code entry never appeared'))
  assert.match(document.body.textContent!, /6-digit code to ada@example\.com/)
  const send = calls.find((c) => c.url.includes('/verification-codes'))!
  assert.match(send.body, /dest=ada%40example\.com/)
  assert.match(send.body, /type=email/)
  assert.match(send.body, /applicationId=admin%2Fhanzo-console/)
  assert.equal(created(), 0, 'nothing is created before the code')

  fireEvent.change(field('Code')!, { target: { value: '424242' } })
  submit()

  await waitFor(() => assert.equal(created(), 1))
  const body = JSON.parse(calls.filter((c) => c.url.includes('/v1/iam/signup')).at(-1)!.body) as Record<string, unknown>
  assert.equal(body.email, 'ada@example.com', 'the address the code went to')
  assert.equal(body.code, '424242')
  assert.equal(body.password, 'correct horse battery staple')
})

// Where no code can be delivered the account is still made, as before, and its
// address stays unproven — a signup that cannot be finished is worse than one
// that cannot prove the address.
test('an application that cannot deliver a code registers without one', async () => {
  const { calls, fetchImpl } = iam({ code: false })
  render(<SignupForm client={createAuthClient({ org: org(), fetchImpl })} />)

  fill()
  submit()

  await waitFor(() => assert.ok(calls.some((c) => c.url.includes('/v1/iam/signup'))))
  assert.equal(calls.filter((c) => c.url.includes('/verification-codes')).length, 0)
  const body = JSON.parse(calls.find((c) => c.url.includes('/v1/iam/signup'))!.body) as Record<string, unknown>
  assert.equal('code' in body, false)
})

// A send IAM refused is its own sentence on screen, and nothing is created.
test('a refused send is shown and creates nothing', async () => {
  const { fetchImpl, created } = iam({ code: true, send: { status: 'error', msg: 'please wait before requesting another code' } })
  render(<SignupForm client={createAuthClient({ org: org(), fetchImpl })} />)

  fill()
  submit()

  await waitFor(() => assert.match(document.body.textContent!, /please wait before requesting another code/))
  assert.equal(field('Code'), null)
  assert.equal(created(), 0)
})

// Back from the code step keeps what was typed, and a changed address gets its own
// code: a code proves the address it was sent to and no other.
test('changing the address sends the new one its own code', async () => {
  const { calls, fetchImpl } = iam({ code: true })
  render(<SignupForm client={createAuthClient({ org: org(), fetchImpl })} />)

  fill()
  submit()
  await waitFor(() => assert.ok(field('Code')))

  fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Change'))!)
  await waitFor(() => assert.ok(field('Email')))
  assert.equal(field('Email')!.value, 'ada@example.com')
  fireEvent.change(field('Email')!, { target: { value: 'grace@example.com' } })
  submit()

  await waitFor(() => assert.match(document.body.textContent!, /6-digit code to grace@example\.com/))
  const sends = calls.filter((c) => c.url.includes('/verification-codes'))
  assert.equal(sends.length, 2)
  assert.match(sends[1]!.body, /dest=grace%40example\.com/)
})

// An address that already has an account is a person who needs back in, not an
// error to read, and they hear it on the first submit: no code goes to an address
// that already has an account. Sign-in and reset both open on that address, for
// the same request.
test('an address that already has an account is answered before any code is sent', async () => {
  const { calls, fetchImpl, created } = iam({ code: true, taken: 'first' })
  render(
    <SignupForm
      client={createAuthClient({ org: org(), fetchImpl })}
      signinHref="/login?client_id=hanzo-console&state=s1"
      forgotHref="/forget?client_id=hanzo-console&state=s1"
    />,
  )

  fill()
  submit()

  await waitFor(() => assert.match(document.body.textContent!, /ada@example\.com already has an account/))
  assert.equal(field('Code'), null, 'no code is asked for')
  assert.equal(calls.filter((c) => c.url.includes('/verification-codes')).length, 0, 'no code is sent')
  assert.equal(created(), 0)
  assert.doesNotMatch(document.body.textContent!, /email already exists/)
  const link = (text: string) => [...document.querySelectorAll('a')].find((a) => a.textContent?.trim() === text)!
  assert.equal(link('Sign in').getAttribute('href'), '/login?client_id=hanzo-console&state=s1&login_hint=ada%40example.com')
  assert.equal(link('Reset password').getAttribute('href'), '/forget?client_id=hanzo-console&state=s1&login_hint=ada%40example.com')

  fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent?.includes('different email'))!)
  await waitFor(() => assert.ok(field('Email')))
  assert.equal(field('Email')!.value, 'ada@example.com')
})

// An IAM that reports the address only once a code is brought still lands on the
// same ways back in, after the code.
test('an address reported taken after the code gets the same ways back in', async () => {
  const { fetchImpl } = iam({ code: true, taken: 'code' })
  render(<SignupForm client={createAuthClient({ org: org(), fetchImpl })} signinHref="/login" />)

  fill()
  submit()
  await waitFor(() => assert.ok(field('Code')))
  fireEvent.change(field('Code')!, { target: { value: '424242' } })
  submit()

  await waitFor(() => assert.match(document.body.textContent!, /ada@example\.com already has an account/))
  const signin = [...document.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Sign in')!
  assert.equal(signin.getAttribute('href'), '/login?login_hint=ada%40example.com')
})

// A password the org refuses is refused on the first submit too, before a code is
// spent on an account that could not be made with it.
test('a refused password is answered before any code is sent', async () => {
  const { fetchImpl } = iam({ code: true })
  const refusing = (async (input: RequestInfo | URL, init?: RequestInit) =>
    input.toString().includes('/v1/iam/signup')
      ? new Response(JSON.stringify({ status: 'error', msg: 'the password must contain at least one digit' }), { status: 200 })
      : fetchImpl(input, init)) as typeof fetch
  render(<SignupForm client={createAuthClient({ org: org(), fetchImpl: refusing })} />)

  fill()
  submit()

  await waitFor(() => assert.match(document.body.textContent!, /at least one digit/))
  assert.equal(field('Code'), null)
})
