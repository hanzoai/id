/**
 * Multi-chain wallet login orchestration tests — pure, no network, no wallet
 * libs. Run with: pnpm --filter @hanzo/id-auth test
 *
 * Locks the connect→nonce→sign→verify→redirect contract against
 * `hanzoai/iam` controllers/web3_auth.go using a capturing fetch double and a
 * fake signer (the injectable `WalletSigner` seam — the real one lazy-loads the
 * wallet libs, which this test never touches).
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createAuthClient } from './client.ts'
import {
  attachParkedWallet,
  loginWithWalletChain,
  detectWalletChains,
  offeredWalletChains,
  parkWallet,
  parkedWallet,
  WALLET_CHAIN_LABELS,
  type WalletSigner,
} from './web3.ts'
import { CHAINS } from '@hanzo/id-connect'
import type { Chain, LoginChallenge, SignedProof } from '@hanzo/id-connect'
import type { Org } from '@hanzo/id-shared'

function org(overrides: Partial<Org> = {}): Org {
  return {
    orgId: 'hanzo',
    iamUrl: 'https://hanzo.id',
    iamIssuer: 'https://hanzo.id',
    clientId: 'hanzo-id',
    appName: 'hanzo-id',
    publicOrigin: 'https://hanzo.id',
    brandPackage: '@hanzo/brand',
    ...overrides,
  }
}

const CHALLENGE: LoginChallenge = {
  domain: 'hanzo.id',
  uri: 'https://hanzo.id',
  nonce: 'NONCE1234567890A',
  issuedAt: '2026-01-01T00:00:00.000Z',
  expirationTime: '2026-01-01T00:10:00.000Z',
  version: '1',
}

/**
 * Capturing fetch: returns the minted CHALLENGE for the nonce GET, and a canned
 * IAM "ok" body for the verify POST (an auth code in `data`, like /v1/iam/login).
 * Records every call so the test can assert the exact wire shape.
 */
function capturingFetch(verifyData: unknown = 'AUTHCODE') {
  const calls: { url: string; method: string; body: Record<string, unknown> }[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = init?.method ?? 'GET'
    let body: Record<string, unknown> = {}
    if (init?.body && typeof init.body === 'string') body = JSON.parse(init.body)
    calls.push({ url, method, body })
    if (url.includes('/v1/iam/web3/nonce')) {
      return new Response(JSON.stringify({ status: 'ok', data: CHALLENGE }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    // verify
    return new Response(JSON.stringify({ status: 'ok', data: verifyData }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return { calls, fetchImpl }
}

/** Fake signer: records the (chain, challenge) it was handed, returns a proof. */
function fakeSigner() {
  const seen: { chain: Chain; challenge: LoginChallenge }[] = []
  const proof: SignedProof = {
    chain: 'evm',
    scheme: 'secp256k1-eip191',
    address: '0xabc0000000000000000000000000000000000def',
    message: 'rendered CAIP-122 message',
    signature: '0xdeadbeef',
  }
  const sign: WalletSigner = async (chain, challenge) => {
    seen.push({ chain, challenge })
    return { ...proof, chain }
  }
  return { seen, sign, proof }
}

test('fetches the nonce for the chosen chain, signs the returned challenge, POSTs the proof', async () => {
  const { calls, fetchImpl } = capturingFetch()
  const { seen, sign } = fakeSigner()
  const client = createAuthClient({ org: org(), fetchImpl })

  const res = await loginWithWalletChain(client, 'evm', {}, fetchImpl, sign)

  // 1) nonce GET first, scoped to the chain, on the brand's own iamUrl.
  assert.equal(calls[0]!.method, 'GET')
  assert.match(calls[0]!.url, /^https:\/\/hanzo\.id\/v1\/iam\/web3\/nonce\?chain=evm$/)

  // 2) the server challenge was handed to the signer (nonce/domain/uri/times
  //    intact — the server-minted, single-use values the proof must bind).
  assert.equal(seen.length, 1)
  assert.equal(seen[0]!.chain, 'evm')
  assert.equal(seen[0]!.challenge.nonce, CHALLENGE.nonce)
  assert.equal(seen[0]!.challenge.domain, CHALLENGE.domain)
  assert.equal(seen[0]!.challenge.uri, CHALLENGE.uri)
  assert.equal(seen[0]!.challenge.issuedAt, CHALLENGE.issuedAt)
  assert.equal(seen[0]!.challenge.expirationTime, CHALLENGE.expirationTime)

  // 3) the proof + routing was POSTed to verify.
  const verify = calls[1]!
  assert.equal(verify.method, 'POST')
  assert.match(verify.url, /\/v1\/iam\/web3\/verify$/)
  assert.equal(verify.body.chain, 'evm')
  assert.equal(verify.body.scheme, 'secp256k1-eip191')
  assert.equal(verify.body.address, '0xabc0000000000000000000000000000000000def')
  assert.equal(verify.body.message, 'rendered CAIP-122 message')
  assert.equal(verify.body.signature, '0xdeadbeef')
  // routing fields the controller needs.
  assert.equal(verify.body.application, 'hanzo-id')
  assert.equal(verify.body.method, 'login')
  assert.equal(verify.body.clientId, 'hanzo-id')
  // bare sign-in (no downstream redirectUri) → type=login.
  assert.equal(verify.body.type, 'login')

  // 4) bare sign-in lands on onboarding — same destination as the password flow.
  assert.equal(res.redirectUrl, '/onboarding')
  assert.equal(res.error, undefined)
})

test('SSO flow (downstream redirectUri) sends type=code and returns the app redirect with the minted code', async () => {
  const { calls, fetchImpl } = capturingFetch('CODE_XYZ')
  const { sign } = fakeSigner()
  const client = createAuthClient({ org: org(), fetchImpl })

  const res = await loginWithWalletChain(
    client,
    'evm',
    { redirectUri: 'https://console.hanzo.ai/auth/iam/callback', state: 'rp123', clientId: 'hanzo-console' },
    fetchImpl,
    sign,
  )

  const verify = calls[1]!
  assert.equal(verify.body.type, 'code')
  assert.equal(verify.body.redirectUri, 'https://console.hanzo.ai/auth/iam/callback')
  assert.equal(verify.body.state, 'rp123')
  assert.equal(verify.body.clientId, 'hanzo-console')
  assert.equal(
    res.redirectUrl,
    'https://console.hanzo.ai/auth/iam/callback?code=CODE_XYZ&state=rp123',
  )
})

// What wallet sign-in offers is the INTERSECTION of two facts that live on two
// different sides: the families IAM will verify (auth/methods -> web3Chains, read
// from the same list its nonce and verify endpoints gate on) and the families this
// bundle has a connector for (@hanzo/id-connect CHAINS).
//
// It used to be a hardcoded ['evm','solana'] in this module — a COPY of a server
// policy, which could only drift, and did: IAM answers a real CAIP-122 challenge on
// seven families, five of them signable here, and the copy offered two.
test('the offer is what IAM verifies, narrowed to what this browser can sign', async () => {
  const answered = (chains: unknown) =>
    (async () =>
      new Response(JSON.stringify({ status: 'ok', data: { web3: true, web3Chains: chains } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch

  // The seven families live IAM publishes today.
  assert.deepEqual(
    await offeredWalletChains(org(), 'hanzo-console',
      answered(['evm', 'solana', 'bitcoin', 'ton', 'xrp', 'polkadot', 'cardano'])),
    ['evm', 'solana', 'bitcoin', 'ton', 'xrp'],
    'polkadot and cardano have no connector here, so they are not offered',
  )
  // A server that narrows its list narrows the screen with no client change.
  assert.deepEqual(await offeredWalletChains(org(), 'hanzo-console', answered(['evm'])), ['evm'])
  // And every chain that can be offered has a label to render.
  for (const c of CHAINS) assert.ok(WALLET_CHAIN_LABELS[c])
})

test('an unreadable capability offers no wallet at all', async () => {
  const dead = (async () => {
    throw new Error('network down')
  }) as unknown as typeof fetch
  assert.deepEqual(await offeredWalletChains(org(), 'hanzo-console', dead), [])

  const refused = (async () =>
    new Response(JSON.stringify({ status: 'error', msg: 'the application does not exist' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch
  assert.deepEqual(await offeredWalletChains(org(), 'hanzo-console', refused), [])
})

test('a wallet rejection surfaces as { error } (not a throw), and verify is never called', async () => {
  const { calls, fetchImpl } = capturingFetch()
  const sign: WalletSigner = async () => {
    throw new Error('User rejected the request')
  }
  const client = createAuthClient({ org: org(), fetchImpl })
  const res = await loginWithWalletChain(client, 'evm', {}, fetchImpl, sign)
  assert.equal(res.error, 'User rejected the request')
  // nonce was fetched (1 call) but verify was NOT (no 2nd call).
  assert.equal(calls.length, 1)
  assert.match(calls[0]!.url, /\/v1\/iam\/web3\/nonce/)
})

test('detectWalletChains: a single injected wallet resolves to exactly its chain', () => {
  // EVM only → [evm]; the UI connects straight, no chooser.
  assert.deepEqual(detectWalletChains(CHAINS, { ethereum: {} }), ['evm'])
  // Solana only, via any of the recognized injected providers → [solana].
  assert.deepEqual(detectWalletChains(CHAINS, { solana: {} }), ['solana'])
  assert.deepEqual(detectWalletChains(CHAINS, { solflare: {} }), ['solana'])
  assert.deepEqual(detectWalletChains(CHAINS, { backpack: {} }), ['solana'])
})

test('detectWalletChains: both injected → both, in offered order (chooser)', () => {
  assert.deepEqual(detectWalletChains(CHAINS, { ethereum: {}, solana: {} }), ['evm', 'solana'])
})

test('detectWalletChains never reaches past what is offered', () => {
  // An injected EVM wallet on a screen offering only Solana is NOT auto-connected:
  // detection is a narrowing of the offer, never an addition to it.
  assert.deepEqual(detectWalletChains(['solana'], { ethereum: {} }), [])
})

test('detectWalletChains: nothing injected → [] (chooser, all still reachable)', () => {
  // No window (server / node) and an empty window both resolve to none — the UI
  // then reveals the chooser so every offered family stays selectable regardless.
  assert.deepEqual(detectWalletChains(CHAINS, {}), [])
  assert.deepEqual(detectWalletChains(CHAINS, undefined), [])
  assert.deepEqual(detectWalletChains(CHAINS), []) // node has no global window
})

test('an IAM verify error is returned as { error }', async () => {
  const calls: string[] = []
  const fetchImpl: typeof fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push(url)
    if (url.includes('/web3/nonce')) {
      return new Response(JSON.stringify({ status: 'ok', data: CHALLENGE }), { status: 200 })
    }
    return new Response(JSON.stringify({ status: 'error', msg: 'web3: bad signature' }), { status: 200 })
  }
  const { sign } = fakeSigner()
  const client = createAuthClient({ org: org(), fetchImpl })
  const res = await loginWithWalletChain(client, 'evm', {}, fetchImpl, sign)
  assert.equal(res.error, 'web3: bad signature')
  assert.equal(res.redirectUrl, undefined)
})

/** A session store for tests: the Storage surface over a Map. */
function memory(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  }
}

test('a wallet nobody holds is refused as unlinked, with the address, not as a dead end', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = input.toString()
    if (url.includes('/v1/iam/web3/nonce')) {
      return new Response(JSON.stringify({ status: 'ok', data: CHALLENGE }), { status: 200 })
    }
    return new Response(JSON.stringify({ status: 'error', msg: 'web3: no account is linked to this wallet' }), { status: 200 })
  }
  const { sign, proof } = fakeSigner()
  const client = createAuthClient({ org: org(), fetchImpl })
  const res = await loginWithWalletChain(client, 'evm', {}, fetchImpl, sign)
  assert.equal(res.unlinked, true)
  assert.equal(res.walletAddress, proof.address)
  assert.match(res.error ?? '', /no account is linked/)
})

test('any other refusal is not unlinked', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = input.toString()
    if (url.includes('/v1/iam/web3/nonce')) {
      return new Response(JSON.stringify({ status: 'ok', data: CHALLENGE }), { status: 200 })
    }
    return new Response(JSON.stringify({ status: 'error', msg: 'web3: this wallet is already linked to another account' }), { status: 200 })
  }
  const { sign } = fakeSigner()
  const res = await loginWithWalletChain(createAuthClient({ org: org(), fetchImpl }), 'evm', {}, fetchImpl, sign)
  assert.equal(res.unlinked, false)
})

test('a parked wallet is read once, and only a known chain comes back', () => {
  const store = memory()
  parkWallet('solana', store)
  assert.equal(parkedWallet(store), 'solana')
  assert.equal(parkedWallet(store), null)
  store.setItem('hanzo_id_wallet_to_attach', 'not-a-chain')
  assert.equal(parkedWallet(store), null)
})

test('after a sign-in the parked wallet runs the flow once more, with a session, and the park is cleared', async () => {
  const store = memory()
  parkWallet('evm', store)
  const { calls, fetchImpl } = capturingFetch('AUTHCODE')
  const { sign, seen } = fakeSigner()
  const client = createAuthClient({ org: org(), fetchImpl })
  const res = await attachParkedWallet(client, fetchImpl, sign, store)
  assert.equal(seen.length, 1, 'signed once')
  assert.equal(calls.filter((c) => c.url.includes('/v1/iam/web3/verify')).length, 1, 'verified once')
  assert.equal(res?.walletAddress, '0xabc0000000000000000000000000000000000def')
  assert.equal(parkedWallet(store), null, 'the park is cleared')
})

test('with nothing parked, a sign-in attaches nothing and touches no wallet', async () => {
  const { calls, fetchImpl } = capturingFetch()
  const { sign, seen } = fakeSigner()
  const res = await attachParkedWallet(createAuthClient({ org: org(), fetchImpl }), fetchImpl, sign, memory())
  assert.equal(res, null)
  assert.equal(seen.length, 0)
  assert.equal(calls.length, 0)
})

test('a declined second signature does not fail the sign-in it follows', async () => {
  const store = memory()
  parkWallet('evm', store)
  const { fetchImpl } = capturingFetch()
  const sign: WalletSigner = async () => {
    throw new Error('User rejected the request')
  }
  const res = await attachParkedWallet(createAuthClient({ org: org(), fetchImpl }), fetchImpl, sign, store)
  assert.match(res?.error ?? '', /rejected/)
})
