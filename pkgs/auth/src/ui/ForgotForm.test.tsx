/**
 * Recovery, end to end on one screen: ask for a code, then spend it on a new
 * password.
 *
 * The second half is what this pins. The page used to promise it in prose — "sign
 * in with the code, then set a new password" — while no endpoint could set one, so
 * a person who followed the instruction arrived somewhere with nothing to do.
 */
import { afterEach, test } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { OrgConfig } from '@hanzo/id-shared'
import { createAuthClient } from '../client'
import { ForgotForm } from './ForgotForm'

afterEach(cleanup)

function org(): OrgConfig {
  return {
    orgId: 'hanzo',
    iamUrl: 'https://hanzo.id',
    iamIssuer: 'https://hanzo.id',
    clientId: 'hanzo-id',
    appName: 'hanzo-id',
    publicOrigin: 'https://hanzo.id',
    brandPackage: '@hanzo/brand',
  } as OrgConfig
}

/**
 * An IAM double: the descriptor, the code send, and the password write. `code` is
 * the descriptor's own code-sign-in switch — set false on purpose, because a reset
 * must not depend on the application also offering passwordless sign-in.
 */
function iam(opts: { code?: boolean; send?: unknown; set?: unknown; setStatus?: number } = {}) {
  const calls: { method: string; url: string; body: string; type: string | null }[] = []
  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString()
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      calls.push({ method, url, body: String(init?.body ?? ''), type: new Headers(init?.headers).get('Content-Type') })
    }
    if (url.includes('/verification-codes')) return json(opts.send ?? { status: 'ok' })
    if (url.includes('/v1/iam/password')) return json(opts.set ?? { status: 'ok' }, opts.setStatus ?? 200)
    return json({
      status: 'ok',
      data: {
        owner: 'admin',
        name: 'hanzo-id',
        organization: 'hanzo',
        enablePassword: true,
        enableCodeSignin: opts.code === true,
        providers: [],
      },
    })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
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

// THE PATH. Send a code, spend it, and be told the password is set — with the
// application's code sign-in switched OFF, because a reset is not passwordless
// sign-in and must not be gated on it. Gating it there refused recovery to every
// application that does not also want a code arm at the login screen.
test('a code is sent, then spent on a new password', async () => {
  const { calls, fetchImpl } = iam({ code: false })
  render(<ForgotForm client={createAuthClient({ org: org(), fetchImpl })} />)

  fireEvent.change(field('Email')!, { target: { value: 'ada@hanzo.ai' } })
  submit()

  // Stage two: the code that arrived, and the password it buys.
  await waitFor(() => assert.ok(field('Code'), 'the code entry never appeared'))
  assert.match(document.body.textContent!, /6-digit code to ada@hanzo\.ai/)
  assert.ok(field('New password'), 'there is nowhere to type the new password')

  const send = calls.find((c) => c.url.includes('/verification-codes'))!
  assert.match(send.type!, /application\/x-www-form-urlencoded/, 'the send endpoint reads a form body only')
  assert.match(send.body, /dest=ada%40hanzo\.ai/)

  fireEvent.change(field('Code')!, { target: { value: '424242' } })
  fireEvent.change(field('New password')!, { target: { value: 'correct horse battery' } })
  submit()

  await waitFor(() => assert.match(document.body.textContent!, /Your new password is set/))

  const set = calls.find((c) => c.url.endsWith('/v1/iam/password'))!
  assert.equal(set.method, 'PUT')
  const body = JSON.parse(set.body) as Record<string, unknown>
  // The SAME address the code went to: IAM redeems a code against the account it was
  // minted for, so the second stage is not a chance to name another one.
  assert.equal(body.username, 'ada@hanzo.ai')
  assert.equal(body.organization, 'hanzo')
  assert.equal(body.code, '424242')
  assert.equal(body.password, 'correct horse battery')
  assert.equal('oldPassword' in body, false, 'one proof per request')
})

// A refusal is the server's own sentence, not a status code. IAM answers its one
// opaque refusal in `msg` alongside a 400, and reading `res.ok` first replaced it
// with "HTTP 400" — the exact string a person saw on the live forgot screen.
test('the refusal shown is the one IAM gave', async () => {
  const { fetchImpl } = iam({
    code: false,
    set: { status: 'error', msg: 'the code is incorrect or has expired' },
    setStatus: 400,
  })
  render(<ForgotForm client={createAuthClient({ org: org(), fetchImpl })} />)

  fireEvent.change(field('Email')!, { target: { value: 'ada@hanzo.ai' } })
  submit()
  await waitFor(() => assert.ok(field('Code')))

  fireEvent.change(field('Code')!, { target: { value: '000000' } })
  fireEvent.change(field('New password')!, { target: { value: 'correct horse battery' } })
  submit()

  await waitFor(() => assert.match(document.body.textContent!, /the code is incorrect or has expired/))
  assert.doesNotMatch(document.body.textContent!, /HTTP 400/)
  // Still on the step, so the person can retype the code rather than start over.
  assert.ok(field('Code'), 'a refusal threw away the step')
})

// A failed SEND keeps the person where they can act on it, rather than advancing to
// a code that was never sent.
test('a send that fails does not advance to the code step', async () => {
  const { fetchImpl } = iam({
    code: false,
    send: { status: 'error', msg: 'verification codes cannot be delivered: no notify service is configured' },
  })
  render(<ForgotForm client={createAuthClient({ org: org(), fetchImpl })} />)

  fireEvent.change(field('Email')!, { target: { value: 'ada@hanzo.ai' } })
  submit()

  await waitFor(() => assert.match(document.body.textContent!, /cannot be delivered/))
  assert.equal(field('Code'), null, 'the code step opened for a code nobody sent')
})
