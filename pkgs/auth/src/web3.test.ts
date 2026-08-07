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
  loginWithWalletChain,
  detectWalletChains,
  ENABLED_WALLET_CHAINS,
  WALLET_CHAIN_LABELS,
  type WalletSigner,
} from './web3.ts'
import type { Chain, LoginChallenge, SignedProof } from '@hanzo/id-connect'
import type { OrgConfig } from '@hanzo/id-shared'

function org(overrides: Partial<OrgConfig> = {}): OrgConfig {
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

test('disabled chains are not offered and fail closed without any network or signer call', async () => {
  // The stub-verifier chains must NOT be in the enabled set...
  for (const stub of ['ton', 'xrp', 'bitcoin'] as const) {
    assert.equal(ENABLED_WALLET_CHAINS.includes(stub), false, `${stub} must be disabled`)
  }
  // ...and only the production-verifier chains are.
  assert.deepEqual([...ENABLED_WALLET_CHAINS], ['evm', 'solana'])
  // every enabled chain has a render label.
  for (const c of ENABLED_WALLET_CHAINS) assert.ok(WALLET_CHAIN_LABELS[c])

  // Calling a disabled chain returns an error and touches neither fetch nor signer.
  const { calls, fetchImpl } = capturingFetch()
  let signed = false
  const sign: WalletSigner = async () => {
    signed = true
    throw new Error('signer must not run for a disabled chain')
  }
  const client = createAuthClient({ org: org(), fetchImpl })
  const res = await loginWithWalletChain(client, 'ton', {}, fetchImpl, sign)
  assert.match(res.error ?? '', /not enabled/)
  assert.equal(calls.length, 0)
  assert.equal(signed, false)
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
  assert.deepEqual(detectWalletChains({ ethereum: {} }), ['evm'])
  // Solana only, via any of the recognized injected providers → [solana].
  assert.deepEqual(detectWalletChains({ solana: {} }), ['solana'])
  assert.deepEqual(detectWalletChains({ solflare: {} }), ['solana'])
  assert.deepEqual(detectWalletChains({ backpack: {} }), ['solana'])
})

test('detectWalletChains: both injected → both, in enabled order (chooser)', () => {
  assert.deepEqual(detectWalletChains({ ethereum: {}, solana: {} }), ['evm', 'solana'])
})

test('detectWalletChains: nothing injected → [] (chooser, both still reachable)', () => {
  // No window (server / node) and an empty window both resolve to none — the UI
  // then reveals the chooser so EVM and Solana stay selectable regardless.
  assert.deepEqual(detectWalletChains({}), [])
  assert.deepEqual(detectWalletChains(undefined), [])
  assert.deepEqual(detectWalletChains(), []) // node has no global window
  // Every detectable chain is one the wallet flow actually enables.
  for (const c of detectWalletChains({ ethereum: {}, solana: {} })) {
    assert.ok(ENABLED_WALLET_CHAINS.includes(c))
  }
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
