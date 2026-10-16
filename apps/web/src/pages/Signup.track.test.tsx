/**
 * The account exists before the completion is stated, so stating it can never
 * be what keeps the person on this page: a tag that throws inside `track()`
 * (a broken vendor build, an extension's shim) still lets the browser leave for
 * the app that asked.
 */
import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { Brand } from '@hanzo/id-shared'
import { createAuthClient } from '@hanzo/id-auth'
import { Signup } from './Signup'

vi.mock('@hanzo/event', async (actual) => ({
  ...(await actual<typeof import('@hanzo/event')>()),
  track: () => {
    throw new Error('pixel threw')
  },
}))

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
const REDIRECT = 'https://hanzo.ai/auth/callback'

/** IAM registers the account and mints the code the app asked for. */
const iam = (async (input: RequestInfo | URL) => {
  const path = new URL(input.toString()).pathname
  const body =
    path === '/v1/iam/signup'
      ? { status: 'ok', data: { id: 'u-1', owner: 'hanzo', name: 'ada' } }
      : path === '/v1/iam/login'
        ? { status: 'ok', data: 'c-minted' }
        : { status: 'ok', data: { enableSignUp: true } }
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}) as unknown as typeof fetch

test('a tag that throws at completion does not keep the new account on this page', async () => {
  const request = new URLSearchParams({ client_id: 'hanzo-app', redirect_uri: REDIRECT, response_type: 'code', state: 'S' })
  ;(window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(`https://hanzo.id/signup?${request}`)
  const here = window.location.href
  const gone: string[] = []
  Object.defineProperty(window.location, 'href', { configurable: true, get: () => here, set: (u: string) => void gone.push(u) })
  vi.spyOn(console, 'error').mockImplementation(() => {})

  const { container } = render(<Signup client={createAuthClient({ org: ORG, fetchImpl: iam })} brand={BRAND} />)
  await waitFor(() => assert.ok(container.querySelector('input[type=password]')))
  await act(async () => {
    fireEvent.change(container.querySelector('input[type=email]')!, { target: { value: 'ada@example.com' } })
    fireEvent.change(container.querySelector('input[type=password]')!, { target: { value: 'correct horse battery staple' } })
  })
  await act(async () => void fireEvent.click(container.querySelector('button[type=submit]')!))

  await waitFor(() => assert.equal(gone.length, 1, 'the browser leaves for the app'))
  assert.ok(gone[0]!.startsWith(REDIRECT), `to the app that asked, got ${gone[0]}`)
  assert.equal(container.querySelector('[role=alert]')?.textContent ?? '', '', 'and no error is shown')
})
