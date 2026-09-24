/**
 * The way back from registration to sign-in, for the person who already has an
 * account. It carries the app's request the same way "Create account" carried it
 * here, so either page can be the one they finish on.
 */
import { afterEach, test } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { Brand } from '@hanzo/id-shared'
import { createAuthClient } from '@hanzo/id-auth'
import { Signup } from './Signup'

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

const REQUEST = new URLSearchParams({
  client_id: 'hanzo-app',
  code_challenge: 'AgX39Cb83kllF6GA7XywQjfcBY8fJhLFTbT_dIbqR2c',
  code_challenge_method: 'S256',
  nonce: 'n-1',
  redirect_uri: 'https://hanzo.ai/auth/callback',
  response_type: 'code',
  scope: 'openid profile email',
  state: 'QxkkRKHhvzOvqJm0AqrdG2lhcWmnYk_sSibOcj28USw',
})

function iam(enableSignUp: boolean): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ status: 'ok', data: { name: 'hanzo-app', organization: 'hanzo', enableSignUp } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch
}

const signIn = () =>
  [...document.querySelectorAll('a')].find((a) => a.textContent === 'Sign in')?.getAttribute('href') ?? null

for (const enableSignUp of [true, false]) {
  test(`Sign in carries the whole request back (enableSignUp=${enableSignUp})`, async () => {
    // hanzo.app's "Get started" arrives with signup=true, which /login answers by
    // forwarding here again; the link must not carry it back.
    window.history.replaceState({}, '', `/signup?${REQUEST}&signup=true`)
    render(<Signup client={createAuthClient({ org: ORG, fetchImpl: iam(enableSignUp) })} brand={BRAND} />)
    if (!enableSignUp) await waitFor(() => assert.ok(document.body.textContent?.includes('does not accept new accounts')))
    await waitFor(() => assert.ok(signIn()))

    const to = new URL(signIn()!, 'https://hanzo.id')
    assert.equal(to.pathname, '/login')
    assert.deepEqual([...to.searchParams], [...REQUEST])
  })
}

test('Sign in on /signup/<app> opens /login/<app>', async () => {
  window.history.replaceState({}, '', '/signup/hanzo-chat')
  render(<Signup client={createAuthClient({ org: ORG, fetchImpl: iam(true) })} brand={BRAND} />)
  await waitFor(() => assert.equal(signIn(), '/login/hanzo-chat'))
  assert.ok(document.body.textContent?.includes('Already have an account? Sign in'))
})
