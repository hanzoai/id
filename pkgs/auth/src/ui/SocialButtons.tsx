import { useEffect, useState } from 'react'
import type { ComponentType, SVGProps } from 'react'
import type { AuthClient } from '../client'
import type { AppProvider } from '../types'
import { createIam } from '../iam'
import { GitHubIcon, GoogleIcon, WalletIcon } from './icons'

/**
 * Social + Web3 sign-in buttons.
 *
 * The enabled set is read live from `/v1/iam/get-app-login` (via
 * `client.getAppLogin()`) — the canonical source of truth that mirrors the
 * per-app provider config in `init_data.json` (GitHub + Google + Web3). When
 * that endpoint is unreachable we fall back to the tenant's declared default
 * methods so the buttons still render. Each button drives the canonical
 * `@hanzo/iam` PKCE redirect with the provider passed through as the
 * authorize `provider` param; the portal's `/callback` route completes it.
 *
 * One way: the PKCE verifier/state the SDK writes here is the same one
 * `Callback.tsx` reads back through `IAM.handleCallback`.
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

export function SocialButtons({
  client,
  clientIdOverride,
  intent = 'signin',
  postLoginRedirect,
}: SocialButtonsProps) {
  const [keys, setKeys] = useState<readonly string[] | null>(null)
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
          setKeys([])
          return
        }
        const want = intent === 'signup' ? (p: AppProvider) => p.canSignUp : (p: AppProvider) => p.canSignIn
        // Render ONLY providers IAM actually holds credentials for. A provider
        // with placeholder/empty creds would dead-end the OAuth redirect, so we
        // hide it; it reappears automatically once real creds are seeded.
        const enabled = app.providers
          .filter((p) => want(p) && p.configured && p.key in PROVIDER_META)
          .map((p) => p.key)
        setKeys(enabled)
      })
      .catch(() => {
        if (!cancelled) setKeys([])
      })
    return () => {
      cancelled = true
    }
  }, [client, clientIdOverride, intent])

  if (keys === null) return null // resolving — render nothing rather than flicker
  const ordered = ORDER.filter((k) => keys.includes(k))
  if (ordered.length === 0) return null

  const verb = intent === 'signup' ? 'Sign up' : 'Continue'

  function start(providerKey: string) {
    setError(null)
    // Persist the downstream target across the IAM round-trip; `Callback`
    // reads it back and forwards tokens there (else lands on onboarding).
    if (postLoginRedirect) sessionStorage.setItem('post_login_redirect', postLoginRedirect)
    else sessionStorage.removeItem('post_login_redirect')
    const iam = createIam(client.tenant, clientIdOverride)
    iam.signinRedirect({ additionalParams: { provider: providerKey } }).catch((e) => {
      setError(String(e))
    })
  }

  return (
    <div className="hanzo-id-social">
      {ordered.map((k) => {
        const meta = PROVIDER_META[k]
        const { Icon } = meta
        return (
          <button
            key={k}
            type="button"
            className="hanzo-id-social-btn"
            data-provider={k}
            onClick={() => start(k)}
          >
            <Icon />
            <span>{verb} with {meta.label}</span>
          </button>
        )
      })}
      {error ? <p role="alert" className="hanzo-id-error">{error}</p> : null}
    </div>
  )
}
