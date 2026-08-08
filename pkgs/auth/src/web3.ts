/**
 * Multi-chain wallet Sign-In-With-X — the ONE client-side orchestration.
 *
 * Decomplected: connect+sign is the BROWSER's job (native `@hanzo/id-connect`
 * connectors — viem / @solana injected wallets, no WalletConnect, no projectId),
 * verify is the SERVER's job (IAM `POST /v1/iam/web3/verify`, which runs the same
 * `walletconnect.VerifyProof` the connectors target). This module ties the two
 * into a single call so the UI only picks a chain and follows the redirect.
 *
 *   client: nonce ─► connect ─► signLogin(challenge) ─► SignedProof
 *           ─► POST verify ─► IAM signs in ─► same redirect the password flow uses
 *
 * Wire contract (verified against `hanzoai/iam` controllers/web3_auth.go):
 *   GET  {iamUrl}/v1/iam/web3/nonce?chain=<c>&address=<a>
 *        → {status:'ok', data:{domain,uri,statement,nonce,issuedAt,
 *                              expirationTime,version}}   (a LoginChallenge)
 *   POST {iamUrl}/v1/iam/web3/verify   body = SignedProof + routing fields
 *        → same success shape as /v1/iam/login (auth code | session cookie).
 */
import type { OrgConfig } from '@hanzo/id-shared'
import type { Chain, LoginChallenge, SignedProof } from '@hanzo/id-connect'
import { CHAINS } from '@hanzo/id-connect'
import type { AuthClient } from './client'
import type { LoginResponse } from './types'

/**
 * Connect a wallet on `chain` and sign `challenge`, returning the proof. The
 * single seam between this orchestrator and the browser wallet libs: the default
 * lazy-loads `@hanzo/id-connect/login` (so importing this module never pulls
 * viem/sats-connect, and the wallet bundle is code-split until first use); tests
 * inject a fake. One signature, one way.
 */
export type WalletSigner = (chain: Chain, challenge: LoginChallenge) => Promise<SignedProof>

const defaultSigner: WalletSigner = async (chain, challenge) => {
  const { loginWithWallet } = await import('@hanzo/id-connect/login')
  const { proof } = await loginWithWallet({ chain, challenge })
  return proof
}

/**
 * The chains a wallet may sign in with HERE: the families this IAM will verify a
 * signature for, narrowed to the ones this browser bundle can produce one with.
 *
 * Two different facts, and neither belongs to the other side. IAM publishes what
 * it accepts on `GET /v1/iam/auth/methods` as `web3Chains`, read from the same
 * list its nonce and verify endpoints gate on (`schema.WalletChains`), so a screen
 * cannot offer a chain the verifier refuses. `@hanzo/id-connect` publishes CHAINS,
 * the families it has a connector for, so a screen cannot offer a chain this
 * browser cannot sign. The offer is the intersection.
 *
 * This replaces a hardcoded two-chain list. That list was a COPY of a server
 * policy ("TON / XRP / Bitcoin verifiers are still stubs") kept in the browser,
 * where it could only ever drift: IAM answers a real CAIP-122 challenge on seven
 * families today, five of which this bundle can sign, and the copy offered two.
 *
 * Fails closed to no chains — the same rule the social strip follows, since a
 * button that cannot finish is worse than an absent one.
 */
export async function offeredWalletChains(
  org: OrgConfig,
  clientId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Chain[]> {
  const url = new URL('/v1/iam/auth/methods', org.iamUrl)
  url.searchParams.set('clientId', clientId)
  try {
    const res = await fetchImpl(url.toString(), { headers: { Accept: 'application/json' } })
    const body = (await res.json()) as Record<string, unknown>
    const data = (typeof body.data === 'object' && body.data ? body.data : {}) as Record<string, unknown>
    if (body.status !== 'ok' || !Array.isArray(data.web3Chains)) return []
    return CHAINS.filter((c) => (data.web3Chains as unknown[]).includes(c))
  } catch {
    return []
  }
}

/** Display label per chain, shown on each connect button. */
export const WALLET_CHAIN_LABELS: Record<Chain, string> = {
  evm: 'Ethereum / EVM',
  solana: 'Solana',
  bitcoin: 'Bitcoin',
  ton: 'TON',
  xrp: 'XRP',
}

/** The `window` fields the injected-wallet sniff reads — kept local so the
 * wallet libs stay out of this module (detection is a pure property read). */
export interface WalletWindow {
  readonly ethereum?: unknown
  readonly solana?: unknown
  readonly solflare?: unknown
  readonly backpack?: unknown
}

/** Is an injected wallet for `chain` present on `w`? Mirrors the connectors'
 * own discovery: EVM = `window.ethereum` (EIP-1193 / EIP-6963 legacy handle),
 * Solana = Phantom/Solflare/Backpack injected providers. */
function chainInjected(chain: Chain, w: WalletWindow): boolean {
  switch (chain) {
    case 'evm':
      return Boolean(w.ethereum)
    case 'solana':
      return Boolean(w.solana || w.solflare || w.backpack)
    default:
      // No sniff for this family, so it is never auto-detected — it stays
      // reachable from the chooser, which is the honest answer for a wallet whose
      // presence a page cannot read.
      return false
  }
}

/**
 * Which of the `offered` chains have an injected provider right now. A pure
 * `window` sniff — no connect, no I/O — that powers the chain-agnostic "Connect
 * Wallet" entry: exactly one match → connect straight; zero or many → let the user
 * pick. The offer comes from the caller ({@link offeredWalletChains}), so what can
 * be detected is always a subset of what can complete.
 */
export function detectWalletChains(
  offered: readonly Chain[],
  w: WalletWindow | undefined = typeof window === 'undefined' ? undefined : (window as WalletWindow),
): Chain[] {
  if (!w) return []
  return offered.filter((c) => chainInjected(c, w))
}

/** Routing context for the verify POST — exactly what the password flow carries. */
export interface WalletLoginContext {
  /** Override the OAuth client_id (downstream app); defaults to org.clientId. */
  readonly clientId?: string
  /** Downstream app `redirect_uri`; presence flips the flow to the auth-code (SSO) path. */
  readonly redirectUri?: string
  readonly state?: string
  /** OIDC nonce from the downstream authorize request, echoed into the minted code. */
  readonly nonce?: string
  readonly codeChallenge?: string
  readonly codeChallengeMethod?: 'S256' | 'plain'
}

/**
 * Connect a wallet on `chain`, sign the IAM-minted challenge, and verify it —
 * resolving to the SAME {@link LoginResponse} the password login returns (so the
 * caller reuses one redirect path). Throws only on a programming/transport error
 * the UI can't act on; expected failures (user rejects, bad signature) come back
 * as `{ error }`.
 *
 * This is ALSO how a wallet is BOUND to an account that is already signed in.
 * IAM decides which from the caller it resolves at verify: a live same-site
 * session attaches the wallet to that identity, and no session signs in or signs
 * up. The client sequence is identical either way, so there is one wallet client
 * and no second one to keep in step — the caller just does something different
 * with the answer (onboarding stays put; login follows `redirectUrl`).
 *
 * `client.org.iamUrl` is the fetch base (HIP-0111 host-relative — the brand's
 * own `*.id` host), matching every other AuthClient call.
 */
export async function loginWithWalletChain(
  client: AuthClient,
  chain: Chain,
  ctx: WalletLoginContext = {},
  fetchImpl: typeof fetch = fetch,
  sign: WalletSigner = defaultSigner,
): Promise<LoginResponse> {
  const org = client.org

  // 1. Mint the challenge, then connect+sign atomically (the connector
  //    disconnects on failure). The nonce is fetched without an address — the
  //    controller treats (chain,address) as advisory and binds the real address
  //    from the SIGNED message, so there is no second round-trip to scope it.
  let proof: SignedProof
  try {
    const challenge = await fetchNonce(org, chain, fetchImpl)
    proof = await sign(chain, challenge)
  } catch (err) {
    return { error: errMessage(err) }
  }

  // 2. Verify the proof + routing at IAM. Type defaults to "login" (session
  //    cookie) server-side; a downstream redirectUri makes it the code flow.
  const url = new URL('/v1/iam/web3/verify', org.iamUrl)
  const res = await fetchImpl(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      // routing
      organization: org.loginOrg ?? '',
      application: org.appName,
      method: 'login',
      clientId: ctx.clientId ?? org.clientId,
      redirectUri: ctx.redirectUri ?? '',
      state: ctx.state ?? '',
      scope: 'openid profile email',
      type: ctx.redirectUri ? 'code' : 'login',
      nonce: ctx.nonce ?? '',
      codeChallenge: ctx.codeChallenge ?? '',
      codeChallengeMethod: ctx.codeChallengeMethod ?? '',
      // proof
      chain: proof.chain,
      scheme: proof.scheme,
      address: proof.address,
      publicKey: proof.publicKey ?? '',
      message: proof.message,
      signature: proof.signature,
      extra: proof.extra ?? {},
    }),
  })

  return parseVerifyResponse(res, ctx, proof.address)
}

/** GET the CAIP-122 challenge for (chain) from IAM; throws on a non-ok payload. */
async function fetchNonce(
  org: OrgConfig,
  chain: Chain,
  fetchImpl: typeof fetch,
): Promise<LoginChallenge> {
  const url = new URL('/v1/iam/web3/nonce', org.iamUrl)
  url.searchParams.set('chain', chain)
  const res = await fetchImpl(url.toString(), { headers: { Accept: 'application/json' } })
  let body: Record<string, unknown> = {}
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    throw new Error(`web3 nonce: HTTP ${res.status} non-JSON response`)
  }
  if (!res.ok || body.status !== 'ok' || typeof body.data !== 'object' || body.data === null) {
    throw new Error(typeof body.msg === 'string' ? body.msg : `web3 nonce: HTTP ${res.status}`)
  }
  const d = body.data as Record<string, unknown>
  return {
    domain: String(d.domain ?? ''),
    uri: String(d.uri ?? ''),
    statement: typeof d.statement === 'string' ? d.statement : undefined,
    nonce: String(d.nonce ?? ''),
    issuedAt: String(d.issuedAt ?? ''),
    expirationTime: typeof d.expirationTime === 'string' ? d.expirationTime : undefined,
    version: typeof d.version === 'string' ? d.version : '1',
  }
}

/**
 * Shape the `/v1/iam/web3/verify` response into a {@link LoginResponse}, mirroring
 * the password flow's `parseLoginResponse`: auth-code flow → a redirect back to
 * the downstream app; bare sign-in → land on onboarding.
 */
async function parseVerifyResponse(
  res: Response,
  ctx: WalletLoginContext,
  address: string,
): Promise<LoginResponse> {
  let body: Record<string, unknown> = {}
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    return { error: `HTTP ${res.status} non-JSON response` }
  }
  if (!res.ok || body.status === 'error') {
    return { error: typeof body.msg === 'string' ? body.msg : `HTTP ${res.status}` }
  }
  const data = body.data

  // Auth-code (SSO) flow: a downstream redirectUri is present and `data` is the
  // minted code — hand back a fully-formed redirect to the app.
  if (ctx.redirectUri && typeof data === 'string' && data.length > 0) {
    const sep = ctx.redirectUri.includes('?') ? '&' : '?'
    return {
      walletAddress: address,
      redirectUrl: `${ctx.redirectUri}${sep}code=${encodeURIComponent(data)}&state=${encodeURIComponent(ctx.state ?? '')}`,
    }
  }

  // Bare portal sign-in: the IAM session cookie is set; land on onboarding —
  // identical to the password path so there is one post-login destination.
  return { walletAddress: address, redirectUrl: '/onboarding' }
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
