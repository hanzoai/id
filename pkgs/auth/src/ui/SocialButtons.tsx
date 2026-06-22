import { useEffect, useState } from 'react'
import type { ComponentType, SVGProps } from 'react'
import type { AuthClient } from '../client'
import type { AppProvider } from '../types'
import { createIam } from '../iam'
import { startProviderLogin, isHoppableProvider } from '../social'
import { GitHubIcon, GoogleIcon, WalletIcon } from './icons'
import { Divider } from './Divider'

/**
 * Social + Web3 sign-in buttons.
 *
 * The enabled set is read live from `/v1/iam/get-app-login` (via
 * `client.getAppLogin()`) — the canonical source of truth that mirrors the
 * per-app provider config in `init_data.json`. We render ONLY providers IAM
 * holds real credentials for (`AppProvider.configured`); a provider seeded with
 * placeholder creds is hidden so its button never dead-ends, and reappears once
 * real creds land. When the config is unreadable we render none.
 *
 * Each OAuth button drives the provider "hop" (`startProviderLogin`) — it
 * redirects straight to GitHub/Google with a Casdoor-compatible state that
 * round-trips the original authorize request, so the IAM backend's `/callback`
 * exchange completes it. (Web3/wallet falls back to the `@hanzo/iam` redirect.)
 */
export interface SocialButtonsProps {
  readonly client: AuthClient
  /** Override the OAuth client_id (e.g. a downstream app's id). */
  readonly clientIdOverride?: string
  /** "signin" (default) or "signup" — only changes button copy. */
  readonly intent?: 'signin' | 'signup'
  /**
   * Downstream app's `redirect_uri`, if this portal is mid-flow for another
   * app. Social/Web3 sign-in always returns to the portal's own `/callback`
   * (the SDK's fixed redirectUri), so we stash this target before the
   * redirect; `Callback` reads it back and forwards the tokens there. Absent
   * → a bare portal sign-in that lands on onboarding.
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
        // hide it; it reappears automatically once real creds are seeded.
        const providers: Record<string, AppProvider> = {}
        for (const p of app.providers) {
          if (want(p) && p.configured && p.key in PROVIDER_META) providers[p.key] = p
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

  function start(provider: AppProvider) {
    setError(null)
    // Persist the downstream target across the IAM round-trip; `Callback`
    // reads it back and forwards tokens there (else lands on onboarding).
    if (postLoginRedirect) sessionStorage.setItem('post_login_redirect', postLoginRedirect)
    else sessionStorage.removeItem('post_login_redirect')
    const method = intent === 'signup' ? 'signup' : 'signin'
    // OAuth providers (github/google) hop straight to the provider; wallet/web3
    // falls back to the @hanzo/iam redirect.
    if (isHoppableProvider(provider.type)) {
      startProviderLogin({
        application: resolved!.application,
        providerName: provider.name,
        type: provider.type,
        clientId: provider.clientId,
        scopes: provider.scopes,
        method,
      })
      return
    }
    const iam = createIam(client.tenant, clientIdOverride)
    iam.signinRedirect({ additionalParams: { provider: provider.key } }).catch((e) => {
      setError(String(e))
    })
  }

  return (
    <>
      <div className="hanzo-id-social">
      {ordered.map((k) => {
        const meta = PROVIDER_META[k]
        const { Icon } = meta
        const provider = resolved.providers[k]!
        return (
          <button
            key={k}
            type="button"
            className="hanzo-id-social-btn"
            data-provider={k}
            onClick={() => start(provider)}
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
