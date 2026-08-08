/**
 * What the sign-in strip OFFERS, mounted for real.
 *
 * The rule under test is one sentence: a button appears exactly when the server
 * can complete what it starts. That was previously unverifiable — the runner
 * collected no .tsx and had no document — so the strip could lose a whole sign-in
 * method with both gates green, which is what happened to the wallet.
 */
import { afterEach, test } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { OrgConfig } from '@hanzo/id-shared'
import { createAuthClient } from '../client'
import { SocialButtons } from './SocialButtons'

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
 * An IAM double answering both descriptors the strip reads, with the shapes live
 * prod returns: get-app-login carries the app's provider list (already filtered by
 * IAM's own `offerable`), auth/methods carries the binary's capabilities.
 */
function iam(opts: { providers?: unknown[]; chains?: string[] }) {
  const json = (payload: unknown) =>
    new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
  return (async (input: RequestInfo | URL) => {
    const url = input.toString()
    if (url.includes('/auth/methods')) {
      return json({ status: 'ok', data: { web3: (opts.chains ?? []).length > 0, web3Chains: opts.chains ?? [] } })
    }
    return json({
      status: 'ok',
      data: { owner: 'admin', name: 'hanzo-console', organization: 'hanzo', providers: opts.providers ?? [] },
    })
  }) as unknown as typeof fetch
}

/** The buttons currently drawn, in DOM order, by their provider key. */
function drawn(): (string | undefined)[] {
  return [...document.querySelectorAll('[data-provider]')].map((b) => (b as HTMLElement).dataset.provider)
}

/** Resolve when the strip has rendered (both descriptor reads have landed). */
async function settled(): Promise<void> {
  await waitFor(() => assert.ok(document.querySelector('.hanzo-id-social')))
}

const google = {
  name: 'provider-google',
  canSignIn: true,
  provider: { name: 'provider-google', type: 'Google', clientId: '113591532635-real.apps.googleusercontent.com' },
}
const github = {
  name: 'provider-github',
  canSignIn: true,
  provider: { name: 'provider-github', type: 'GitHub', clientId: 'Iv23li3SYLoq40ExR6EN' },
}

// THE DEFECT. The wallet entry was built from the app's provider LIST, and IAM
// stopped publishing a web3 row there: the seeded provider-web3 is category "OAuth"
// with the unexpanded clientId `${IAM_WEB3_CLIENT_ID}`, IAM's `offerable` drops it,
// and all 80 apps that link it set canSignIn:false. Live get-app-login for
// hanzo-console returns [provider-github, provider-google] and nothing else, so no
// wallet button was drawn on hanzo.id — while /v1/iam/web3/nonce answered a real
// CAIP-122 challenge for evm, solana and bitcoin, and a wallet-only account
// (provisioned by web3/verify, holding no password) had no way to sign in.
test('the wallet entry comes from the capability, with no provider row anywhere', async () => {
  render(
    <SocialButtons
      client={createAuthClient({ org: org(), fetchImpl: iam({ providers: [google, github], chains: ['evm', 'solana', 'bitcoin'] }) })}
    />,
  )
  await settled()

  assert.deepEqual(
    drawn(),
    ['google', 'github', 'web3'],
    'the descriptor carries NO web3 provider row, and the wallet entry must still be drawn',
  )
  assert.equal(document.querySelector('[data-wallet-connect="true"]')?.textContent, 'Connect Wallet')
})

test('a provider row can no longer conjure a wallet the server cannot verify', async () => {
  // The inverse of the defect, and the reason this is a capability read rather than
  // a wider provider filter: a row is not a capability. If IAM's chain list is
  // empty, no wallet entry — whatever any app happens to link.
  const web3Row = {
    name: 'provider-web3',
    canSignIn: true,
    provider: { name: 'provider-web3', type: 'Web3Onboard', clientId: 'real-looking-id' },
  }
  render(
    <SocialButtons client={createAuthClient({ org: org(), fetchImpl: iam({ providers: [google, web3Row], chains: [] }) })} />,
  )
  await settled()

  assert.deepEqual(drawn(), ['google'], 'a linked provider row must not draw a wallet entry')
})

// The strip's order is a product decision that lived in PROVIDER_ORDER and must
// keep governing the wallet too, now that the wallet is not a provider row.
test('google leads and the wallet trails', async () => {
  render(
    <SocialButtons
      client={createAuthClient({ org: org(), fetchImpl: iam({ providers: [github, google], chains: ['evm'] }) })}
    />,
  )

  await settled()

  // The descriptor listed github FIRST; the strip still leads with google.
  assert.deepEqual(drawn(), ['google', 'github', 'web3'])
})

// A chain nobody can sign is a dead end of the same kind as a dead OAuth button.
test('only chains this bundle can sign reach the chooser', async () => {
  render(
    <SocialButtons
      client={createAuthClient({
        org: org(),
        fetchImpl: iam({ chains: ['evm', 'solana', 'bitcoin', 'ton', 'xrp', 'polkadot', 'cardano'] }),
      })}
    />,
  )

  await settled()

  // No injected wallet in this document, so the entry reveals the chooser rather
  // than guessing — every offered family stays reachable from it.
  document.querySelector<HTMLButtonElement>('[data-wallet-connect="true"]')!.click()
  const chains = await waitFor(() => {
    const found = [...document.querySelectorAll('[data-chain]')].map((b) => (b as HTMLElement).dataset.chain)
    assert.ok(found.length > 0, 'the chooser did not open')
    return found
  })
  assert.deepEqual(chains, ['evm', 'solana', 'bitcoin', 'ton', 'xrp'],
    'polkadot and cardano have no connector here, so they must not be offered')
})
