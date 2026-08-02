import type { AuthClient } from '../client'
import type { ProviderInfo } from '../types'

interface Meta {
  readonly label: string
  /** stable brand token used for the CSS class + data attribute (for icon styling) */
  readonly brand: string
}

// Keyed by a normalized provider token (type or name, lowercased, alnum-only,
// "provider" prefix stripped). Falls back to a generic label for anything new.
const META: Record<string, Meta> = {
  google: { label: 'Continue with Google', brand: 'google' },
  github: { label: 'Continue with GitHub', brand: 'github' },
  apple: { label: 'Continue with Apple', brand: 'apple' },
  facebook: { label: 'Continue with Facebook', brand: 'facebook' },
  web3: { label: 'Connect wallet', brand: 'web3' },
  web3onboard: { label: 'Connect wallet', brand: 'web3' },
  metamask: { label: 'Connect wallet', brand: 'web3' },
}

function metaFor(p: ProviderInfo): Meta {
  const key = (p.type || p.name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^provider/, '')
  return META[key] ?? { label: `Continue with ${p.displayName || p.name}`, brand: 'generic' }
}

export interface ProviderButtonsProps {
  readonly client: AuthClient
  readonly providers: ProviderInfo[]
  readonly mode: 'login' | 'signup'
  readonly redirectUri?: string
  readonly state?: string
  readonly clientIdOverride?: string
}

/**
 * Renders one button per social/wallet provider attached to the application.
 * Each links to the IAM authorize endpoint with `provider=<name>`, which
 * initiates that provider's OAuth and returns to `${publicOrigin}/callback`.
 * The set is driven by the live app config (AuthClient.appLogin) — no
 * hardcoded provider list — so enabling a provider in IAM surfaces it here.
 */
export function ProviderButtons(props: ProviderButtonsProps) {
  const { client, providers, mode } = props
  const usable = providers.filter((p) =>
    mode === 'signup' ? p.canSignUp !== false : p.canSignIn !== false,
  )
  if (usable.length === 0) return null

  const redirectUri = props.redirectUri ?? `${client.org.publicOrigin}/callback`
  return (
    <div className="hanzo-id-providers">
      {usable.map((p) => {
        const m = metaFor(p)
        const href = client.authorize({
          clientId: props.clientIdOverride ?? client.org.clientId,
          redirectUri,
          state: props.state ?? mode,
          provider: p.name,
        })
        return (
          <a
            key={p.name}
            className={`hanzo-id-provider-btn hanzo-id-provider-${m.brand}`}
            href={href}
            data-provider={m.brand}
          >
            {m.label}
          </a>
        )
      })}
      <div className="hanzo-id-or">
        <span>or</span>
      </div>
    </div>
  )
}
