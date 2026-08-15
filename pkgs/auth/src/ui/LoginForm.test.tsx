/**
 * What the credential form OFFERS, and what it does with a failure.
 *
 * Two claims, both previously unverifiable and both false: that the arms drawn are
 * the arms IAM will complete, and that a person who presses Enter and is refused
 * can act on the refusal.
 */
import { useState } from 'react'
import { afterEach, test } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { OrgConfig } from '@hanzo/id-shared'
import { createAuthClient, type AuthClient } from '../client'
import { LoginForm } from './LoginForm'

afterEach(cleanup)

function org(): OrgConfig {
  return {
    orgId: 'hanzo',
    iamUrl: 'https://hanzo.id',
    iamIssuer: 'https://hanzo.id',
    clientId: 'hanzo-console',
    appName: 'hanzo-console',
    publicOrigin: 'https://hanzo.id',
    brandPackage: '@hanzo/brand',
  } as OrgConfig
}

/**
 * An IAM double: the login descriptor plus whatever the credential post answers.
 * `code`/`password` are the descriptor's own switches, already ANDed server-side
 * with the capability behind them — which is exactly why the form trusts them.
 */
function iam(opts: { code?: boolean; password?: boolean; login?: unknown; send?: unknown }) {
  const posts: { url: string; body: string; type: string | null }[] = []
  const json = (payload: unknown) =>
    new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString()
    if (init?.method === 'POST') {
      posts.push({ url, body: String(init.body ?? ''), type: new Headers(init.headers).get('Content-Type') })
      if (url.includes('/send-verification-code')) return json(opts.send ?? { status: 'ok' })
      return json(opts.login ?? { status: 'ok', data: 'AUTHCODE' })
    }
    return json({
      status: 'ok',
      data: {
        owner: 'admin',
        name: 'hanzo-console',
        organization: 'hanzo',
        enablePassword: opts.password !== false,
        enableCodeSignin: opts.code === true,
        providers: [],
      },
    })
  }) as unknown as typeof fetch
  return { posts, fetchImpl }
}

/**
 * The input a visible label names — wrapped (the plain fields) or associated by
 * `for` (PasswordField, whose reveal button cannot live inside a label).
 */
function field(label: string): HTMLInputElement | null {
  const l = [...document.querySelectorAll('label')].find((x) => x.textContent?.trim().startsWith(label))
  if (!l) return null
  const inner = l.querySelector('input')
  if (inner) return inner as HTMLInputElement
  const id = l.getAttribute('for')
  return id ? (document.getElementById(id) as HTMLInputElement | null) : null
}

/** Type into a controlled input the way React sees it. */
function type(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } })
}

/** Wait until the descriptor has landed and the form has re-rendered from it. */
async function settled() {
  await waitFor(() => assert.ok(document.querySelector('form')))
}

// THE DEFECT. `enableCodeSignin` was parsed off the descriptor, typed, documented —
// and then dropped: three hits in the whole workspace, two of them type
// declarations. There was no code arm anywhere in the UI, so email/SMS code sign-in
// could never light up no matter what the server said it could deliver. Proven
// behaviourally at the time by route-mocking get-app-login with
// enableCodeSignin:true against live hanzo.id: the DOM still had exactly two inputs
// and no code affordance.

/**
 * The form with its identifier kind held as real state, which is how a page
 * holds it: `kind` is CONTROLLED now, because the control that switches it left
 * the form and became an entry in the sign-in strip ("Continue with Phone").
 *
 * The harness exposes that switch as a bare button so this file keeps testing
 * what it always tested — the FORM's half of the contract, that naming the kind
 * renames the field, changes the keyboard, and never touches the wire. Whether
 * the strip draws the entry and calls back is SocialButtons' half, and it is
 * tested there.
 */
function Harness({ client }: { client: AuthClient }) {
  const [kind, setKind] = useState<'email' | 'phone'>('email')
  return (
    <>
      <button
        type="button"
        data-identifier-kind={kind}
        onClick={() => setKind((k) => (k === 'phone' ? 'email' : 'phone'))}
      />
      <LoginForm client={client} kind={kind} onKind={setKind} />
    </>
  )
}

test('the code arm renders when the descriptor offers it, and not otherwise', async () => {
  const on = iam({ code: true })
  render(<Harness client={createAuthClient({ org: org(), fetchImpl: on.fetchImpl })} />)
  await waitFor(() => assert.ok(document.querySelector('[data-arm-switch]')))

  // The switch is there; taking it reveals the code entry and the send.
  document.querySelector<HTMLButtonElement>('[data-arm-switch]')!.click()
  await waitFor(() => assert.ok(document.querySelector('[data-arm="code"]')))
  assert.ok(document.querySelector('[data-send-code]'), 'a code arm with no way to get a code')

  cleanup()

  const off = iam({ code: false })
  render(<Harness client={createAuthClient({ org: org(), fetchImpl: off.fetchImpl })} />)
  await settled()
  assert.equal(document.querySelector('[data-arm-switch]'), null, 'no code to offer, no switch')
  assert.equal(document.querySelector('[data-arm="code"]'), null)
})

// The code IS the credential: it goes where the password goes, on the one login
// endpoint, so the MFA gate and the PKCE tail are true of it by construction.
test('the code arm posts the code, and the send goes to the same identifier', async () => {
  const { posts, fetchImpl } = iam({ code: true })
  render(<Harness client={createAuthClient({ org: org(), fetchImpl })} />)
  await waitFor(() => assert.ok(document.querySelector('[data-arm-switch]')))
  document.querySelector<HTMLButtonElement>('[data-arm-switch]')!.click()
  await waitFor(() => assert.ok(document.querySelector('[data-arm="code"]')))

  type(field('Email or username')!, 'someone@hanzo.ai')
  document.querySelector<HTMLButtonElement>('[data-send-code]')!.click()
  await waitFor(() => assert.equal(posts.length, 1))

  const send = posts[0]!
  assert.match(send.url, /\/v1\/iam\/send-verification-code/)
  assert.equal(send.type, 'application/x-www-form-urlencoded')
  const sent = new URLSearchParams(send.body)
  assert.equal(sent.get('dest'), 'someone@hanzo.ai')
  assert.equal(sent.get('type'), 'email')
  // The application id comes from the descriptor's own owner/name.
  assert.equal(sent.get('applicationId'), 'admin/hanzo-console')

  type(field('Email code')!, '123456')
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await waitFor(() => assert.equal(posts.length, 2))

  const login = JSON.parse(posts[1]!.body)
  assert.match(posts[1]!.url, /\/v1\/iam\/login/)
  assert.equal(login.code, '123456')
  assert.equal('password' in login, false)
  // IAM keys the verification record on the destination the code was SENT to, so
  // the send and the login must carry one identifier string.
  assert.equal(login.username, sent.get('dest'))
})

test('an application that checks no password is not shown a password box', async () => {
  // Latent, not live — every application probed reports password:true — but the same
  // defect shape as the code arm, and the pair drift together if only one is read.
  const { fetchImpl } = iam({ password: false, code: true })
  render(<Harness client={createAuthClient({ org: org(), fetchImpl })} />)

  await waitFor(() => assert.ok(document.querySelector('[data-arm="code"]')))
  assert.equal(field('Password'), null, 'a password form the server would refuse')
  // With one arm there is nothing to switch to.
  assert.equal(document.querySelector('[data-arm-switch]'), null)
})

// The phone entry used to RELABEL this field; it swaps in a control of its own now,
// because a number needs its country stated — the dial code rides on it and the
// grouping is a fact about where it lives. What leaves is still one identifier
// string, which is all IAM ever wanted.
test('choosing phone swaps in the phone control and posts one identifier', async () => {
  const { posts, fetchImpl } = iam({ login: { status: 'error', msg: 'the username or password is incorrect' } })
  render(<Harness client={createAuthClient({ org: org(), fetchImpl })} />)
  await settled()

  assert.equal(field('Email or username')!.getAttribute('autocomplete'), 'username')
  document.querySelector<HTMLButtonElement>('[data-identifier-kind]')!.click()

  // This wait is on a DYNAMIC IMPORT, not on a render. `LoginForm` code-splits
  // `PhoneField` deliberately — 143 kB of libphonenumber country rules that only
  // somebody choosing phone should pay for — and the first person through pays
  // for the transform as well, which is comfortably past waitFor's 1s default.
  // `PhoneField.test.tsx` never sees this because it imports the component
  // directly, so the module is already resolved before its first assertion.
  //
  // The budget was the only thing wrong: this went red on a clean checkout of
  // main, with the control arriving at ~2s and the assertion giving up at 1s.
  // Widen the window, not the claim — a control that never arrives still fails.
  const phone = await waitFor(
    () => {
      const input = field('Phone number')
      assert.ok(input, 'the phone control did not arrive')
      return input!
    },
    { timeout: 10_000 },
  )
  assert.equal(phone.getAttribute('inputmode'), 'tel', 'a number pad, on a phone')
  // tel-national, NOT tel: the country is a separate control, so this field holds
  // the national part and a password manager filling a full number here would put
  // the dial code in twice.
  assert.equal(phone.getAttribute('autocomplete'), 'tel-national')
  assert.equal(phone.getAttribute('type'), 'tel', 'this one only ever takes a number')
  assert.ok(document.querySelector('[data-phone-country]'), 'no country control')

  type(phone, '4155550134')
  type(field('Password')!, 'pw')
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await waitFor(() => assert.equal(posts.length, 1))

  // ONE identifier, in international form. The field shows (415) 555-0134 and sends
  // the number with its country code — which is composition, not normalization:
  // IAM's own lookup still normalizes what it receives (store.NormalizePhone inside
  // GetUserByPhone). Concatenating the dial code onto what was typed would be wrong
  // everywhere a trunk prefix exists, and right here, which is the trap.
  assert.equal(JSON.parse(posts[0]!.body).username, '+1 415 555 0134')
})

// MEASURED on live hanzo.id: after a failed sign-in, document.activeElement.tagName
// was BODY — twice, on the first failure and on a second submit. The submit
// disabled itself while the request was in flight, a disabled element cannot hold
// focus, and nothing put focus back. The person who pressed Enter was left with the
// error announced and unreachable.
test('a refusal keeps focus, names the fields, and lands in a region that was already there', async () => {
  const { fetchImpl } = iam({ login: { status: 'error', msg: 'the username or password is incorrect' } })
  render(<Harness client={createAuthClient({ org: org(), fetchImpl })} />)
  await settled()

  // The region RESTS in the document — before any failure, and pointed at.
  const region = document.querySelector('[role="alert"]')
  assert.ok(region, 'no resting live region: the message is created in the same tick it is announced')
  const identifier = field('Email or username')!
  assert.equal(identifier.getAttribute('aria-describedby'), region!.id)
  assert.equal(identifier.getAttribute('aria-invalid'), null, 'nothing is invalid yet')

  type(identifier, 'zz-probe@example.invalid')
  type(field('Password')!, 'wrong')
  const submit = document.querySelector<HTMLButtonElement>('button[type="submit"]')!
  submit.focus()
  submit.click()

  await waitFor(() => assert.equal(region!.textContent, 'the username or password is incorrect'))
  assert.equal(document.activeElement, submit, 'focus fell off the control the person pressed')
  assert.equal(identifier.getAttribute('aria-invalid'), 'true')
  assert.equal(field('Password')!.getAttribute('aria-invalid'), 'true')
  assert.equal(field('Password')!.getAttribute('aria-describedby'), region!.id)
  // Still reachable, and still refusing re-entry while a request is in flight.
  assert.equal(submit.hasAttribute('disabled'), false)
})

// `aria-disabled` is a REPORT, not a barrier: the control stays focusable and a
// press still reaches the handler (that is the whole point — see Submit). So the
// precondition has to be refused where it is known, or a half-typed code goes to
// IAM and burns one of five attempts against the person who typed it.
test('an incomplete code is refused before it reaches IAM', async () => {
  const { posts, fetchImpl } = iam({ code: true })
  render(<Harness client={createAuthClient({ org: org(), fetchImpl })} />)
  await waitFor(() => assert.ok(document.querySelector('[data-arm-switch]')))
  document.querySelector<HTMLButtonElement>('[data-arm-switch]')!.click()
  await waitFor(() => assert.ok(document.querySelector('[data-arm="code"]')))

  type(field('Email or username')!, 'someone@hanzo.ai')
  type(field('Email code')!, '123')
  const submit = document.querySelector<HTMLButtonElement>('button[type="submit"]')!
  assert.equal(submit.getAttribute('aria-disabled'), 'true')
  assert.equal(submit.hasAttribute('disabled'), false, 'it must still be reachable')
  submit.click()
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await new Promise((r) => setTimeout(r, 50))
  assert.deepEqual(posts, [], 'a three-digit code was posted anyway')
})

// THE ORG IS THE DESCRIPTOR'S, OR THERE IS NO POST.
//
// IAM scopes every credential lookup to one org and refuses an org-less login —
// with HTTP 200 and {"status":"error"}, so the form renders it where a wrong
// password lands and the person is told to retype a credential that was fine.
// The form used to fall back to `org.loginOrg`, which no catalog row sets on any
// host, so a descriptor that did not land dropped the field entirely: a request
// that could only fail, blamed on the password.
//
// This is the shape that made `hanzo-cms` look unloggable while `hanzo-console`
// worked — one code path, and the only difference was whether the read landed.
test('a login is never assembled without the org the descriptor carries', async () => {
  const posts: string[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString()
    if (init?.method === 'POST') {
      posts.push(url)
      return new Response(JSON.stringify({ status: 'ok', data: 'AUTHCODE' }), { status: 200 })
    }
    // The descriptor cannot be read — IAM's own answer for a client it will not
    // describe. It is 200, which is why nothing downstream notices on its own.
    return new Response(JSON.stringify({ status: 'error', msg: 'the application does not exist' }), { status: 200 })
  }) as unknown as typeof fetch

  render(<Harness client={createAuthClient({ org: org(), fetchImpl })} />)
  await settled()
  type(field('Email or username')!, 'z@hanzo.ai')
  type(field('Password')!, 'correct horse battery staple')
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await new Promise((r) => setTimeout(r, 50))

  assert.deepEqual(posts, [], 'an org-less login was posted — IAM can only refuse it')
  await waitFor(() =>
    assert.match(
      document.body.textContent ?? '',
      /cannot read the sign-in configuration/,
      'the person was left to guess at their own password',
    ),
  )
})
