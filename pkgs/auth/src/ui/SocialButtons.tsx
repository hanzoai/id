import { Fragment, useEffect, useRef, useState } from 'react'
import type { ComponentType, SVGProps } from 'react'
import type { Chain } from '@hanzo/id-connect'
import type { AuthClient } from '../client'
import type { AppProvider } from '../types'
import { authorizeRequest, matchProviderHint, PROVIDER_ORDER } from '../social'
import { createIam } from '../iam'
import {
  loginWithWalletChain,
  detectWalletChains,
  ENABLED_WALLET_CHAINS,
  WALLET_CHAIN_LABELS,
} from '../web3'
import { GitHubIcon, GitLabIcon, GoogleIcon, WalletIcon } from './icons'
import { Divider } from './Divider'

/**
 * Social + multi-chain wallet sign-in buttons.
 *
 * The enabled set is read live from `/v1/iam/get-app-login` (via
 * `client.getAppLogin()`) — the canonical source of truth that mirrors the
 * per-app provider config in `init_data.json`. We render ONLY providers IAM
 * holds real credentials for (`AppProvider.configured`); a provider seeded with
 * placeholder creds is hidden so its button never dead-ends, and reappears once
 * real creds land. When the config is unreadable we render none.
 *
 * Two sign-in shapes, decomplected:
 *   - OAuth (github/google/gitlab) → FEDERATION: name the provider on IAM's own
 *     authorize endpoint (`?provider=provider-github`) and let IAM run the entire
 *     IdP leg server-side, where the client secret lives. See `social.ts`. This
 *     browser never builds an IdP URL and never sees a provider code.
 *   - Web3/wallet → native Sign-In-With-X (`loginWithWalletChain`): connect a
 *     wallet with `@hanzo/id-connect` (no WalletConnect, no projectId), sign the
 *     IAM-minted challenge, POST `/v1/iam/web3/verify`, then follow the SAME
 *     redirect the password flow returns. The wallet provider renders ONE
 *     chain-agnostic "Connect Wallet" button: it auto-detects the injected
 *     chain (`detectWalletChains`) and connects straight when exactly one is
 *     present, else reveals a chooser so either EVM or Solana stays reachable.
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

/** Display metadata for the providers the portal knows how to render. */
const PROVIDER_META: Record<string, ProviderMeta> = {
  github: { key: 'github', label: 'GitHub', Icon: GitHubIcon },
  gitlab: { key: 'gitlab', label: 'GitLab', Icon: GitLabIcon },
  google: { key: 'google', label: 'Google', Icon: GoogleIcon },
  web3: { key: 'web3', label: 'Wallet', Icon: WalletIcon },
}

interface Resolved {
  /** Configured + renderable providers, keyed by their normalized key. */
  readonly providers: Record<string, AppProvider>
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
    client
      .getAppLogin(clientIdOverride, oidcRedirectUri)
      .then((app) => {
        if (cancelled) return
        if (!app) {
          // Can't read the app config → render no social rather than risk a
          // dead-end button. Password / email-code still render.
          setResolved({ providers: {} })
          onAutoStartResolved?.(false)
          return
        }
        const want = intent === 'signup' ? (p: AppProvider) => p.canSignUp : (p: AppProvider) => p.canSignIn
        // Render ONLY providers IAM actually holds credentials for. A provider
        // with placeholder/empty creds would dead-end the OAuth redirect, so we
        // hide it; it reappears automatically once real creds are seeded. Web3
        // needs no IAM-side OAuth credential (the wallet IS the credential), so
        // it renders whenever the app enables it.
        const providers: Record<string, AppProvider> = {}
        for (const p of app.providers) {
          const enabled = p.key === 'web3' ? want(p) : want(p) && p.configured
          if (enabled && p.key in PROVIDER_META) providers[p.key] = p
        }
        setResolved({ providers })
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
        setResolved({ providers: {} })
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
  const ordered = PROVIDER_ORDER.filter((k) => k in resolved.providers)
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

  // The chain-agnostic entry: auto-detect the injected wallet and connect
  // straight when exactly one chain is available; otherwise reveal the chooser
  // so the user picks EVM or Solana. Both underlying flows stay reachable.
  function onConnectWallet() {
    setError(null)
    const detected = detectWalletChains()
    if (detected.length === 1) startWallet(detected[0]!)
    else setWalletMenu(true)
  }

  return (
    <>
      <div className="hanzo-id-social">
        {ordered.map((k) => {
          const provider = resolved.providers[k]!
          // Web3 expands into one connect button per ENABLED chain; OAuth
          // providers render a single hop button.
          if (k === 'web3') {
            // ONE chain-agnostic entry. It connects straight when a single
            // wallet is detected, else expands into the chooser below — so the
            // page always shows exactly one "Connect Wallet" button, with both
            // EVM and Solana reachable from it.
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
                  <span>{busyChain !== null && !walletMenu ? 'Connecting…' : 'Connect Wallet'}</span>
                </button>
                {walletMenu ? (
                  <div
                    className="hanzo-id-wallet-chains"
                    role="group"
                    aria-label="Choose a wallet network"
                  >
                    {ENABLED_WALLET_CHAINS.map((chain) => (
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
        {error ? <p role="alert" className="hanzo-id-error">{error}</p> : null}
      </div>
      {/* The "or" separator belongs WITH the social block — render it only when
          there are buttons, so it never dangles above the password form when
          no providers are configured. */}
      <Divider />
    </>
  )
}
