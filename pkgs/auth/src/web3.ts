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
import type { TenantConfig } from '@hanzo/id-shared'
import type { Chain, LoginChallenge, SignedProof } from '@hanzo/id-connect'
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
 * Chains whose wallet login is ENABLED. The server-side verifiers for EVM and
 * Solana are production-grade; TON / XRP / Bitcoin verifiers are still stubs and
 * would fail closed, so they are NOT offered. Adding a chain later is one line
 * here (once its Go verifier is real). Single source of truth — the UI renders
 * exactly this set.
 */
export const ENABLED_WALLET_CHAINS: readonly Chain[] = ['evm', 'solana']

/** Display label per chain, shown on each connect button. */
export const WALLET_CHAIN_LABELS: Record<Chain, string> = {
  evm: 'Ethereum / EVM',
  solana: 'Solana',
  bitcoin: 'Bitcoin',
  ton: 'TON',
  xrp: 'XRP',
}

/** Routing context for the verify POST — exactly what the password flow carries. */
export interface WalletLoginContext {
  /** Override the OAuth client_id (downstream app); defaults to tenant.clientId. */
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
 * `client.tenant.iamUrl` is the fetch base (HIP-0111 host-relative — the brand's
 * own `*.id` host), matching every other AuthClient call.
 */
export async function loginWithWalletChain(
  client: AuthClient,
  chain: Chain,
  ctx: WalletLoginContext = {},
  fetchImpl: typeof fetch = fetch,
  sign: WalletSigner = defaultSigner,
): Promise<LoginResponse> {
  const tenant = client.tenant
  if (!ENABLED_WALLET_CHAINS.includes(chain)) {
    return { error: `wallet login not enabled for ${chain}` }
  }

  // 1. Mint the challenge, then connect+sign atomically (the connector
  //    disconnects on failure). The nonce is fetched without an address — the
  //    controller treats (chain,address) as advisory and binds the real address
  //    from the SIGNED message, so there is no second round-trip to scope it.
  let proof: SignedProof
  try {
    const challenge = await fetchNonce(tenant, chain, fetchImpl)
    proof = await sign(chain, challenge)
  } catch (err) {
    return { error: errMessage(err) }
  }

  // 2. Verify the proof + routing at IAM. Type defaults to "login" (session
  //    cookie) server-side; a downstream redirectUri makes it the code flow.
  const url = new URL('/v1/iam/web3/verify', tenant.iamUrl)
  const res = await fetchImpl(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      // routing
      organization: tenant.loginOrg ?? '',
      application: tenant.appName,
      method: 'login',
      clientId: ctx.clientId ?? tenant.clientId,
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

  return parseVerifyResponse(res, ctx)
}

/** GET the CAIP-122 challenge for (chain) from IAM; throws on a non-ok payload. */
async function fetchNonce(
  tenant: TenantConfig,
  chain: Chain,
  fetchImpl: typeof fetch,
): Promise<LoginChallenge> {
  const url = new URL('/v1/iam/web3/nonce', tenant.iamUrl)
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
      redirectUrl: `${ctx.redirectUri}${sep}code=${encodeURIComponent(data)}&state=${encodeURIComponent(ctx.state ?? '')}`,
    }
  }

  // Bare portal sign-in: the IAM session cookie is set; land on onboarding —
  // identical to the password path so there is one post-login destination.
  return { redirectUrl: '/onboarding' }
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
