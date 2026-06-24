import { useEffect, useState } from 'react'
import type { ComponentType, SVGProps } from 'react'
import type { Chain } from '@hanzo/id-connect'
import type { AuthClient } from '../client'
import type { AppProvider } from '../types'
import { startProviderLogin, isHoppableProvider } from '../social'
import { loginWithWalletChain, ENABLED_WALLET_CHAINS, WALLET_CHAIN_LABELS } from '../web3'
import { GitHubIcon, GoogleIcon, WalletIcon } from './icons'
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
 *   - OAuth (github/google) → the provider "hop" (`startProviderLogin`): redirect
 *     straight to the provider; the IAM backend `/callback` exchange completes it.
 *   - Web3/wallet → native Sign-In-With-X (`loginWithWalletChain`): connect a
 *     wallet with `@hanzo/id-connect` (no WalletConnect, no projectId), sign the
 *     IAM-minted challenge, POST `/v1/iam/web3/verify`, then follow the SAME
 *     redirect the password flow returns. The wallet provider expands into one
 *     button per ENABLED chain.
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
}

interface ProviderMeta {
  readonly key: string
  readonly label: string
  readonly Icon: ComponentType<SVGProps<SVGSVGElement>>
}

/** Display metadata for the providers the portal knows how to render. */
const PROVIDER_META: Record<string, ProviderMeta> = {
  github: { key: 'github', label: 'GitHub', Icon: GitHubIcon },
  google: { key: 'google', label: 'Google', Icon: GoogleIcon },
  web3: { key: 'web3', label: 'Wallet', Icon: WalletIcon },
}

/** Canonical render order. */
const ORDER = ['github', 'google', 'web3']

interface Resolved {
  /** IAM application name (for the provider-hop state). */
  readonly application: string
  /** Configured + renderable providers, keyed by their normalized key. */
  readonly providers: Record<string, AppProvider>
}

export function SocialButtons({
  client,
  clientIdOverride,
  intent = 'signin',
  postLoginRedirect,
}: SocialButtonsProps) {
  const [resolved, setResolved] = useState<Resolved | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyChain, setBusyChain] = useState<Chain | null>(null)

  useEffect(() => {
    let cancelled = false
    client
      .getAppLogin(clientIdOverride)
      .then((app) => {
        if (cancelled) return
        if (!app) {
          // Can't read the app config → render no social rather than risk a
          // dead-end button. Password / email-code still render.
          setResolved({ application: '', providers: {} })
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
        setResolved({ application: app.application, providers })
      })
      .catch(() => {
        if (!cancelled) setResolved({ application: '', providers: {} })
      })
    return () => {
      cancelled = true
    }
  }, [client, clientIdOverride, intent])

  if (resolved === null) return null // resolving — render nothing rather than flicker
  const ordered = ORDER.filter((k) => k in resolved.providers)
  if (ordered.length === 0) return null

  const verb = intent === 'signup' ? 'Sign up' : 'Continue'

  function startOAuth(provider: AppProvider) {
    setError(null)
    // Persist the downstream target across the IAM round-trip; `Callback`
    // reads it back and forwards tokens there (else lands on onboarding).
    if (postLoginRedirect) sessionStorage.setItem('post_login_redirect', postLoginRedirect)
    else sessionStorage.removeItem('post_login_redirect')
    const method = intent === 'signup' ? 'signup' : 'signin'
    startProviderLogin(
      {
        application: resolved!.application,
        providerName: provider.name,
        type: provider.type,
        clientId: provider.clientId,
        scopes: provider.scopes,
        method,
      },
      // The shared OAuth client is registered against the IAM backend's
      // /callback (not this brand host), so the hop must return there or the
      // provider rejects the redirect_uri. Catalog-driven; defaults to host.
      client.tenant.oauthCallbackOrigin,
    )
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

  return (
    <>
      <div className="hanzo-id-social">
        {ordered.map((k) => {
          const provider = resolved.providers[k]!
          // Web3 expands into one connect button per ENABLED chain; OAuth
          // providers render a single hop button.
          if (k === 'web3') {
            return ENABLED_WALLET_CHAINS.map((chain) => (
              <button
                key={`web3-${chain}`}
                type="button"
                className="hanzo-id-social-btn"
                data-provider="web3"
                data-chain={chain}
                disabled={busyChain !== null}
                onClick={() => startWallet(chain)}
              >
                <WalletIcon />
                <span>
                  {busyChain === chain ? 'Connecting…' : `${verb} with ${WALLET_CHAIN_LABELS[chain]}`}
                </span>
              </button>
            ))
          }
          if (!isHoppableProvider(provider.type)) return null
          const meta = PROVIDER_META[k]!
          const { Icon } = meta
          return (
            <button
              key={k}
              type="button"
              className="hanzo-id-social-btn"
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
