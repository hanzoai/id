/**
 * The account page's chip, wired to IAM: it lists every account signed in on
 * this browser, and switching makes the chosen one current at IAM, drops the
 * token that named the other, and reads the page again.
 */
import { afterEach, onTestFinished, test } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { Brand } from '@hanzo/id-shared'
import { createAuthClient } from '@hanzo/id-auth'
import { Account } from './Account'

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

const BOB = { sub: 'b-2', owner: 'hanzo', name: 'bob', displayName: 'Bob Tester', email: 'bob@example.test' }
const ALICE = { sub: 'a-1', owner: 'hanzo', name: 'alice', displayName: 'Alice Tester', email: 'alice@example.test' }

type Call = { path: string; method: string; body?: unknown }

/** IAM for a browser where Bob is current and Alice is signed in too. */
function iam(calls: Call[]): typeof fetch {
  const json = (data: unknown) =>
    new Response(JSON.stringify({ status: 'ok', data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input.toString())
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ path: url.pathname, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url.pathname === '/v1/iam/account') return json({ ...BOB, id: BOB.sub })
    if (url.pathname === '/v1/iam/accounts') return json(method === 'PUT' ? [ALICE, BOB] : [BOB, ALICE])
    return new Response(JSON.stringify({ status: 'error', msg: 'unauthorized' }), { status: 401 })
  }) as unknown as typeof fetch
}

test('the chip lists every account here, and a switch is made at IAM before the page reads again', async () => {
  const calls: Call[] = []
  const f = iam(calls)
  const g = globalThis as { fetch: typeof fetch }
  const prior = g.fetch
  g.fetch = f
  onTestFinished(() => {
    g.fetch = prior
  })
  let reloaded = 0
  Object.defineProperty(window.location, 'reload', { configurable: true, value: () => void reloaded++ })
  onTestFinished(() => {
    delete (window.location as unknown as Record<string, unknown>).reload
  })
  window.history.replaceState({}, '', '/account')
  sessionStorage.setItem('hanzo_iam_access_token', 'a token for bob')

  render(<Account client={createAuthClient({ org: ORG, fetchImpl: f })} brand={BRAND} org={ORG} />)

  const chip = await waitFor(() => {
    const b = document.querySelector('button[aria-haspopup="menu"][aria-label^="Account: "]') as HTMLButtonElement | null
    assert.ok(b, 'the chip renders')
    return b
  })
  await waitFor(() => assert.ok(calls.some((c) => c.path === '/v1/iam/accounts' && c.method === 'GET')))
  fireEvent.click(chip)
  const alice = await waitFor(() => {
    const e = [...document.querySelectorAll('[role="menuitemradio"]')].find((x) => x.textContent?.includes('alice@example.test'))
    assert.ok(e, 'alice is listed beside bob')
    return e as HTMLElement
  })
  fireEvent.click(alice)

  await waitFor(() => assert.equal(reloaded, 1))
  const put = calls.find((c) => c.method === 'PUT')
  assert.deepEqual(put, { path: '/v1/iam/accounts', method: 'PUT', body: { current: 'a-1' } })
  assert.equal(sessionStorage.getItem('hanzo_iam_access_token'), null, "bob's token is dropped on the switch")
})
