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

// A phone number has always worked on the wire; nothing said so. The toggle is the
// saying — and it must stay a LABEL, not a second normalizer.
test('the phone toggle renames the field and changes the keyboard, never the wire', async () => {
  const { posts, fetchImpl } = iam({ login: { status: 'error', msg: 'the username or password is incorrect' } })
  render(<Harness client={createAuthClient({ org: org(), fetchImpl })} />)
  await settled()

  assert.equal(field('Email or username')!.getAttribute('autocomplete'), 'username')
  document.querySelector<HTMLButtonElement>('[data-identifier-kind]')!.click()

  const phone = await waitFor(() => {
    const input = field('Phone number')
    assert.ok(input, 'the field is not renamed')
    return input!
  })
  assert.equal(phone.getAttribute('inputmode'), 'tel', 'a number pad, on a phone')
  assert.equal(phone.getAttribute('autocomplete'), 'tel')
  assert.equal(phone.getAttribute('type'), 'text', 'never type=tel: this field still takes an email')

  type(phone, '+1 (415) 555-0134')
  type(field('Password')!, 'pw')
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await waitFor(() => assert.equal(posts.length, 1))

  // Exactly as typed. IAM's own lookup normalizes (store.NormalizePhone inside
  // GetUserByPhone); a second normalizer here is how two spellings stop agreeing.
  assert.equal(JSON.parse(posts[0]!.body).username, '+1 (415) 555-0134')
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
