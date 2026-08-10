import { Fragment, useEffect, useId, useRef, useState } from 'react'
import type { ComponentType, SVGProps } from 'react'
import type { Chain } from '@hanzo/id-connect'
import type { AuthClient } from '../client'
import type { AppProvider } from '../types'
import { authorizeRequest, matchProviderHint, PROVIDER_ORDER } from '../social'
import { createIam } from '../iam'
import { loginWithWalletChain, detectWalletChains, WALLET_CHAIN_LABELS } from '../web3'
import { GitHubIcon, GitLabIcon, GoogleIcon, WalletIcon } from './icons'
import { Alert } from './Alert'
import { Divider } from './Divider'

/**
 * Social + multi-chain wallet sign-in buttons.
 *
 * Two sign-in shapes, decomplected — and they are answered by two DIFFERENT
 * questions, which is the whole shape of this component:
 *
 *   - OAuth (github/google/gitlab) is per-APPLICATION config, so it comes from
 *     `/v1/iam/get-app-login`: which providers this app links, and IAM has already
 *     dropped the ones that cannot complete (`offerable` — no real credential, or
 *     no federation dialect that can drive it). Starting one is FEDERATION: name
 *     the provider on IAM's own authorize endpoint (`?provider=provider-github`)
 *     and let IAM run the entire IdP leg server-side, where the client secret
 *     lives. See `social.ts`. This browser never builds an IdP URL and never sees
 *     a provider code.
 *
 *   - Wallet sign-in is a capability of the IAM BINARY, not of an app's provider
 *     list, so it is asked of `/v1/iam/auth/methods` (`offeredWalletChains`).
 *     Reading it off a linked provider is what made it unreachable: the seeded
 *     provider-web3 row is category "OAuth" with the unexpanded clientId
 *     `${IAM_WEB3_CLIENT_ID}`, all 80 apps that link it set canSignIn:false, and
 *     IAM drops it from the descriptor's provider list entirely — while
 *     /v1/iam/web3/nonce answers a real CAIP-122 challenge on seven families. So
 *     the button was gated on a row that governs nothing and a wallet-only account
 *     (provisioned by /v1/iam/web3/verify, holding no password) had no way in.
 *     The flow itself is native Sign-In-With-X (`loginWithWalletChain`): connect
 *     with `@hanzo/id-connect` (no WalletConnect, no projectId), sign the
 *     IAM-minted challenge, POST `/v1/iam/web3/verify`, then follow the SAME
 *     redirect the password flow returns. It renders ONE chain-agnostic "Connect
 *     Wallet" entry: it auto-detects the injected chain (`detectWalletChains`) and
 *     connects straight when exactly one is present, else reveals a chooser so
 *     every offered family stays reachable.
 *
 * When either read fails we render nothing for it rather than a maybe-dead button.
 */
export interface SocialButtonsProps {
  readonly client: AuthClient
  /** Override the OAuth client_id (e.g. a downstream app's id). */
  readonly clientIdOverride?: string
  /** "signin" (default) or "signup" — only changes button copy. */
  readonly intent?: 'signin' | 'signup'
  /**
   * Downstream app's `redirect_uri`, if this portal is mid-flow for another
   * app. OAuth sign-in returns to the portal's own `/callback` (stashed here
   * and forwarded by `Callback`); wallet sign-in threads it straight into the
   * verify POST so IAM mints the auth-code redirect back to the app. Absent →
   * a bare portal sign-in that lands on onboarding.
   */
  readonly postLoginRedirect?: string
  /**
   * A `provider_hint` from the authorize query — the console passes
   * `?provider_hint=provider-github` when a user clicks "Continue with GitHub"
   * over there. When set, once the app config resolves this component launches
   * the matching provider's hop straight away (the SAME hop the button runs) and
   * renders NOTHING: it is headless, a pure side-effect, so the caller shows its
   * own "signing you in" state. If the hint matches no configured provider,
   * `onAutoStartResolved(false)` fires so the caller can fall back to the form.
   */
  readonly autoStart?: string
  /**
   * Called once, in `autoStart` mode, after the app config resolves: `true` when
   * the hinted provider launched, `false` when the hint matched nothing (so the
   * caller can drop to the interactive form instead of a blank redirect state).
   */
  readonly onAutoStartResolved?: (started: boolean) => void
}

interface ProviderMeta {
  readonly key: string
  readonly label: string
  readonly Icon: ComponentType<SVGProps<SVGSVGElement>>
}

/**
 * Display metadata for the FEDERATED providers, and — because the provider loop
 * admits only keys that appear here — the statement of which keys ARE federated.
 *
 * The wallet is deliberately absent. It has no provider record and no OAuth
 * credential (the wallet IS the credential), and its slot in the strip is filled
 * from the capability instead. While `web3` sat in this table a provider row of
 * that key could enter the federated map, and then a `provider_hint=web3` would be
 * handed to the authorize endpoint, which refuses it ("provider is not a supported
 * federation type") and error-redirects the app — an OAuth failure where the person
 * expected their wallet. Leaving the key out is what makes that unreachable rather
 * than merely unlikely.
 */
const PROVIDER_META: Record<string, ProviderMeta> = {
  github: { key: 'github', label: 'GitHub', Icon: GitHubIcon },
  gitlab: { key: 'gitlab', label: 'GitLab', Icon: GitLabIcon },
  google: { key: 'google', label: 'Google', Icon: GoogleIcon },
}

interface Resolved {
  /** Configured + renderable providers, keyed by their normalized key. */
  readonly providers: Record<string, AppProvider>
  /** Chain families a wallet may sign in with here; empty → no wallet entry. */
  readonly wallet: readonly Chain[]
}

export function SocialButtons({
  client,
  clientIdOverride,
  intent = 'signin',
  postLoginRedirect,
  autoStart,
  onAutoStartResolved,
}: SocialButtonsProps) {
  const [resolved, setResolved] = useState<Resolved | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyChain, setBusyChain] = useState<Chain | null>(null)
  // The chain-agnostic wallet entry reveals a chooser only when it can't decide
  // for the user (zero or multiple injected wallets); a single injected wallet
  // connects straight without ever showing it.
  const [walletMenu, setWalletMenu] = useState(false)
  const autoStarted = useRef(false)
  const errorId = useId()

  // Start federation: hand the provider's NAME to IAM's authorize endpoint and
  // let IAM run the whole IdP leg. Shared by the button click and the `autoStart`
  // auto-launch so both take the identical path.
  //
  // Two arms, and they are the same two the password path already branches on
  // (`Login.completeAfterAuth`) — the question is only who owns the PKCE verifier:
  //
  //   an app sent the user here → re-enter authorize with THAT app's request, so
  //   IAM mints the code against its client_id, redirect_uri and challenge and
  //   returns the browser straight to it. The app holds the verifier; this portal
  //   is never in the return path and never touches a token.
  //
  //   a bare portal sign-in → the portal is its own client, so the IAM SDK mints
  //   and stores the verifier that `Callback` reads back. `post_login_redirect`
  //   carries a non-OIDC "come back here" target (device approval), which is why
  //   it belongs to this arm alone: it is only ever read by the portal's own
  //   callback, and only this arm runs it.
  function hop(provider: AppProvider) {
    const app = authorizeRequest(window.location.search, clientIdOverride ?? client.org.clientId)
    if (app) {
      sessionStorage.removeItem('post_login_redirect')
      window.location.assign(client.authorize({ ...app, provider: provider.name }))
      return
    }
    if (postLoginRedirect) sessionStorage.setItem('post_login_redirect', postLoginRedirect)
    else sessionStorage.removeItem('post_login_redirect')
    // Bare arm = the portal signs in as ITSELF, always. Threading a downstream
    // app's client_id in here paired it with the portal's own `/callback` — a
    // hybrid no app registers (that pairing was the older model), so IAM
    // answered "invalid redirect_uri", and `Callback` (portal client) could
    // never have redeemed the code anyway. An app that wants a code arrives as
    // a full authorize request and takes the arm above.
    createIam(client.org)
      .signinRedirect({ additionalParams: { provider: provider.name } })
      .catch((e) => setError(String(e)))
  }

  useEffect(() => {
    let cancelled = false
    // Read the app config against the DOWNSTREAM app's own redirect_uri (carried
    // on the authorize query in the SSO flow), not the portal's /callback — IAM
    // validates it against the app's registered list, and a cross-app clientId
    // (e.g. console's `hanzo-cloud` viewed from hanzo.id) does NOT register the
    // portal callback, so hardcoding it drops the whole response and no social
    // resolves. Absent (bare portal / device flow) → getAppLogin defaults it.
    const oidcRedirectUri =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('redirect_uri') ?? undefined
        : undefined
    // Two reads, two questions: what this APPLICATION offers, and what this IAM
    // can verify a wallet signature for. They are independent, so one failing
    // never removes the other's buttons — offeredWalletChains resolves to [].
    Promise.all([
      client.getAppLogin(clientIdOverride, oidcRedirectUri),
      client.walletChains(clientIdOverride),
    ])
      .then(([app, wallet]) => {
        if (cancelled) return
        if (!app) {
          // Can't read the app config → render no social rather than risk a
          // dead-end button. Password / email-code still render.
          setResolved({ providers: {}, wallet })
          onAutoStartResolved?.(false)
          return
        }
        const want = intent === 'signup' ? (p: AppProvider) => p.canSignUp : (p: AppProvider) => p.canSignIn
        // Render ONLY providers IAM actually holds credentials for. A provider
        // with placeholder/empty creds would dead-end the OAuth redirect, so we
        // hide it; it reappears automatically once real creds are seeded.
        const providers: Record<string, AppProvider> = {}
        for (const p of app.providers) {
          if (want(p) && p.configured && p.key in PROVIDER_META) providers[p.key] = p
        }
        setResolved({ providers, wallet })
        // A client that already knows the provider (console `?provider_hint=…`)
        // launches it straight away — the SAME hop the button runs, so a click
        // over there lands directly in the provider flow, no second press and no
        // bounce through this login page.
        if (autoStart && !autoStarted.current) {
          autoStarted.current = true
          const target = matchProviderHint(Object.values(providers), autoStart)
          if (target) {
            onAutoStartResolved?.(true)
            hop(target)
          } else {
            // Hint names a provider this app doesn't offer → let the caller show
            // the form rather than dead-end on a blank "signing you in".
            onAutoStartResolved?.(false)
          }
        }
      })
      .catch(() => {
        if (cancelled) return
        setResolved({ providers: {}, wallet: [] })
        onAutoStartResolved?.(false)
      })
    return () => {
      cancelled = true
    }
    // Run once on mount: getAppLogin is a one-shot and autoStart is fixed for
    // the life of the page; the ref guards the hop against a double-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, clientIdOverride, intent])

  // In autoStart mode the component is headless — it exists only to run the hop
  // above; the caller renders its own "signing you in" state. Render nothing.
  if (autoStart) return null
  if (resolved === null) return null // resolving — render nothing rather than flicker
  // ONE order for the whole strip, wallet included — PROVIDER_ORDER is where that
  // decision lives (google leads, the wallet trails). The wallet's slot is filled
  // by the capability, every other slot by the app's own provider list.
  const ordered = PROVIDER_ORDER.filter((k) =>
    k === 'web3' ? resolved.wallet.length > 0 : k in resolved.providers,
  )
  if (ordered.length === 0) return null

  const verb = intent === 'signup' ? 'Sign up' : 'Continue'

  function startOAuth(provider: AppProvider) {
    setError(null)
    hop(provider)
  }

  async function startWallet(chain: Chain) {
    setError(null)
    setBusyChain(chain)
    try {
      const sp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
      const res = await loginWithWalletChain(client, chain, {
        clientId: clientIdOverride,
        redirectUri: postLoginRedirect,
        state: sp.get('state') ?? undefined,
        nonce: sp.get('nonce') ?? undefined,
        codeChallenge: sp.get('code_challenge') ?? undefined,
        codeChallengeMethod: (sp.get('code_challenge_method') as 'S256' | 'plain' | null) ?? undefined,
      })
      if (res.error) {
        setError(res.error)
      } else if (res.redirectUrl) {
        // Same post-login redirect the password flow performs.
        window.location.href = res.redirectUrl
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setBusyChain(null)
    }
  }

  // The chain-agnostic entry: auto-detect the injected wallet and connect straight
  // when exactly one of the OFFERED chains is available; otherwise reveal the
  // chooser so the person picks. Every offered family stays reachable.
  function onConnectWallet() {
    setError(null)
    const detected = detectWalletChains(resolved!.wallet)
    if (detected.length === 1) startWallet(detected[0]!)
    else setWalletMenu(true)
  }

  return (
    <>
      {/* The "or" separator belongs WITH the social block and renders only when
          there are buttons, so it never dangles beside a lone password form on an
          app with no providers configured. It leads the block now rather than
          trailing it, because the strip sits BELOW the credential form: the rule
          separates what is above it from what is below it, and a separator that
          stays put while the things it separates swap ends up marking the boundary
          between the social block and the page footer. */}
      <Divider />
      <div className="hanzo-id-social">
        {ordered.map((k) => {
          if (k === 'web3') {
            // ONE chain-agnostic entry. It connects straight when a single wallet
            // is detected, else expands into the chooser below — so the page always
            // shows exactly one "Connect Wallet" button, with every offered family
            // reachable from it.
            return (
              <Fragment key="web3">
                <button
                  type="button"
                  className="hanzo-id-btn ghost"
                  data-provider="web3"
                  data-wallet-connect="true"
                  aria-expanded={walletMenu}
                  disabled={busyChain !== null}
                  onClick={onConnectWallet}
                >
                  <WalletIcon />
                  {/* "{verb} with Wallet", not "Connect Wallet": every other entry
                      in this strip reads "Continue with X", and one row breaking
                      the pattern reads as a different KIND of action rather than
                      the same action with a different credential. It follows the
                      strip's verb, so the signup surface says "Sign up with
                      Wallet" exactly as it does for Google. */}
                  <span>
                    {busyChain !== null && !walletMenu ? 'Connecting…' : `${verb} with Wallet`}
                  </span>
                </button>
                {walletMenu ? (
                  <div
                    className="hanzo-id-wallet-chains"
                    role="group"
                    aria-label="Choose a wallet network"
                  >
                    {resolved.wallet.map((chain) => (
                      <button
                        key={`web3-${chain}`}
                        type="button"
                        className="hanzo-id-btn ghost"
                        data-provider="web3"
                        data-chain={chain}
                        disabled={busyChain !== null}
                        onClick={() => startWallet(chain)}
                      >
                        <WalletIcon />
                        <span>{busyChain === chain ? 'Connecting…' : WALLET_CHAIN_LABELS[chain]}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </Fragment>
            )
          }
          const provider = resolved.providers[k]!
          const meta = PROVIDER_META[k]!
          const { Icon } = meta
          return (
            <button
              key={k}
              type="button"
              className="hanzo-id-btn ghost"
              data-provider={k}
              onClick={() => startOAuth(provider)}
            >
              <Icon />
              <span>{verb} with {meta.label}</span>
            </button>
          )
        })}
        <Alert id={errorId} message={error} />
      </div>
    </>
  )
}
