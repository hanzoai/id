/**
 * Signing in on the device-approval page when IAM holds the sign-in.
 *
 * The page signs a person in with the same form the login page uses, and IAM may
 * hold that sign-in until the account's address is proven. The page then stops on
 * "Confirm your email" — and asks nothing about the device until the person is
 * actually signed in, because that read is gated on the session the hold has not
 * made yet.
 */
import { afterEach, test } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { Brand } from '@hanzo/id-shared'
import { createAuthClient } from '@hanzo/id-auth'
import { DeviceApproval } from './DeviceApproval'

afterEach(cleanup)

const ORG = {
  orgId: 'hanzo',
  iamUrl: 'https://hanzo.id',
  iamIssuer: 'https://hanzo.id',
  clientId: 'hanzo-id',
  appName: 'hanzo-id',
  publicOrigin: 'https://hanzo.id',
  brandPackage: '@hanzo/brand',
} as Parameters<typeof createAuthClient>[0]['org']

const BRAND = { name: 'Hanzo', logoUrl: '', faviconUrl: '' } as unknown as Brand

/**
 * An IAM double for a signed-out browser: sign-in posts take `answers` in turn,
 * and every path asked for is recorded.
 */
function iam(answers: unknown[], paths: string[]): typeof fetch {
  let signins = 0
  const json = (payload: unknown) =>
    new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(input.toString()).pathname
    paths.push(path)
    if (path === '/v1/iam/account') return json({ status: 'error', msg: 'please sign in first' })
    if (path === '/v1/iam/login' && init?.method === 'POST') return json(answers[signins++])
    if (path === '/v1/iam/oauth/device/info') return json({ status: 'ok', data: { clientId: 'hanzo-cli', displayName: 'Hanzo CLI' } })
    if (path === '/v1/iam/auth/application') {
      return json({ status: 'ok', data: { owner: 'admin', name: 'hanzo-id', organization: 'hanzo', enablePassword: true, providers: [] } })
    }
    return json({ status: 'ok', data: {} })
  }) as unknown as typeof fetch
}

const h1 = () => document.querySelector('h1')?.textContent

async function signIn() {
  await waitFor(() => assert.equal(h1(), 'Sign in to approve your device'))
  await waitFor(() =>
    assert.equal(document.querySelector('button[type="submit"]')?.getAttribute('aria-disabled'), 'false'),
  )
  fireEvent.change(document.querySelector('input[autocomplete=username]')!, { target: { value: 'ada' } })
  fireEvent.change(document.querySelector('input[type=password]')!, { target: { value: 'correct horse battery staple' } })
  fireEvent.submit(document.querySelector('form')!)
}

const HELD = { status: 'ok', data: 'RequiredEmail', data2: { email: 'ada@example.com' } }

test('a held sign-in confirms its address here, then the device is named and offered for approval', async () => {
  window.history.replaceState({}, '', '/login/oauth/device?user_code=ABCD2345')
  const paths: string[] = []
  render(<DeviceApproval client={createAuthClient({ org: ORG, fetchImpl: iam([HELD, { status: 'ok', data: '' }], paths) })} brand={BRAND} />)

  await signIn()
  await waitFor(() => assert.equal(h1(), 'Confirm your email'))
  assert.match(document.body.textContent ?? '', /We sent a 6-digit code to ada@example\.com\./)
  // Not signed in yet, so nothing asks about the device: that read is session-gated
  // and would answer login_required, throwing the person back to the form.
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(paths.includes('/v1/iam/oauth/device/info'), false)

  fireEvent.change(document.querySelector('input[autocomplete="one-time-code"]')!, { target: { value: '424242' } })
  fireEvent.submit(document.querySelector('form')!)

  await waitFor(() => assert.equal(h1(), 'Approve this device'))
  await waitFor(() => assert.match(document.body.textContent ?? '', /Hanzo CLI/))
})

test('a sign-in held for a second factor says where to finish it, instead of doing nothing', async () => {
  window.history.replaceState({}, '', '/login/oauth/device?user_code=ABCD2345')
  const next = { status: 'ok', data: 'NextMfa', mfa: [{ mfaType: 'app', enabled: true }] }
  render(<DeviceApproval client={createAuthClient({ org: ORG, fetchImpl: iam([next], []) })} brand={BRAND} />)

  await signIn()
  await waitFor(() => assert.match(document.querySelector('[role="alert"]')?.textContent ?? '', /two-factor authentication/))
  assert.equal(h1(), 'Sign in to approve your device')
})
