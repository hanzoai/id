/**
 * What the callback page does with a return it CANNOT complete.
 *
 * Three outcomes, and the discriminator is the failure itself rather than the
 * page: a stale return restarts the sign-in, a second stale return stops, and a
 * sign-in that genuinely went wrong is reported and never restarted.
 *
 * The first case is the one that stranded somebody: `@hanzo/iam` refuses a
 * callback whose `state` this origin holds no transaction for — correctly, since
 * that check IS the CSRF protection — and this page printed the refusal and
 * offered nothing, on a page whose only instruction was to restart.
 */
import { afterEach, beforeEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { Brand, Org } from '@hanzo/id-shared'
import { Callback } from './Callback'

// The failure this mounted page will see. Set per test, before render.
let failure = ''
const navigated: string[] = []

vi.mock('@hanzo/id-auth', () => ({
  createIam: () => ({
    handleCallback: () => Promise.reject(new Error(failure)),
  }),
  createAuthClient: () => ({}),
  attachParkedWallet: async () => {},
}))

const ORG = { orgId: 'hanzo', iamUrl: 'https://hanzo.id', iamIssuer: 'https://hanzo.id' } as unknown as Org
const BRAND = { name: 'Hanzo' } as unknown as Brand

beforeEach(() => {
  navigated.length = 0
  sessionStorage.clear()
  // happy-dom's location is read-only enough that a spy will not take; the page
  // reads nothing off it but `replace`, so a stand-in is the whole contract.
  Object.defineProperty(window, 'location', {
    value: {
      href: 'https://hanzo.id/callback?code=abc&state=stale-state',
      origin: 'https://hanzo.id',
      replace: (url: string) => navigated.push(url),
    },
    writable: true,
    configurable: true,
  })
})
afterEach(cleanup)

test('a stale return restarts the sign-in instead of dead-ending', async () => {
  failure = 'Error: OAuth state mismatch — stale, concurrent, or forged login. Restart sign-in.'
  const { container } = render(<Callback org={ORG} brand={BRAND} />)

  await waitFor(() => assert.equal(navigated.length, 1))
  assert.equal(navigated[0], '/login', 'sent back to the portal login page')
  assert.equal(sessionStorage.getItem('hanzo_id_callback_restarted'), '1', 'the attempt is marked')
  assert.equal(container.querySelector('[role="alert"]'), null, 'no dead-end error rendered')
})

test('a second stale return stops rather than looping', async () => {
  failure = 'Error: OAuth state mismatch — stale, concurrent, or forged login. Restart sign-in.'
  sessionStorage.setItem('hanzo_id_callback_restarted', '1')
  const { findByRole } = render(<Callback org={ORG} brand={BRAND} />)

  const alert = await findByRole('alert')
  assert.match(alert.textContent ?? '', /state mismatch/i)
  assert.equal(navigated.length, 0, 'no second restart')
})

test('a sign-in that really failed is reported, never restarted', async () => {
  failure = 'Error: token endpoint answered 503'
  const { findByRole } = render(<Callback org={ORG} brand={BRAND} />)

  const alert = await findByRole('alert')
  assert.match(alert.textContent ?? '', /503/)
  assert.equal(navigated.length, 0, 'a real failure must not bounce the person back')
  assert.equal(sessionStorage.getItem('hanzo_id_callback_restarted'), null, 'and must not mark a restart')
})
