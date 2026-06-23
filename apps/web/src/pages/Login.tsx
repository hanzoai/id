import type { BrandContract, TenantConfig } from '@hanzo/id-shared'
import { LoginForm, type AuthClient } from '@hanzo/id-auth'
import { BrandLogo } from '../components/BrandLogo'
import { MarketingPanel } from '../components/MarketingPanel'
import { marketingFor } from '../marketing'

/**
 * Split-view login (restored from the legacy Next.js design): the login card
 * on the left, the per-org marketing/branding panel on the right (hidden on
 * narrow viewports). The auth wiring is untouched — `<LoginForm>` from
 * `@hanzo/id-auth` still drives the `/v1/iam/login` + code flow.
 */
export function Login({
  client,
  brand,
  tenant,
  signupEnabled,
}: {
  client: AuthClient
  brand: BrandContract
  tenant: TenantConfig
  signupEnabled: boolean
}) {
  const sp = new URLSearchParams(window.location.search)
  const redirectUri = sp.get('redirect_uri') ?? undefined
  const state = sp.get('state') ?? undefined
  const clientIdOverride = sp.get('client_id') ?? undefined
  // OAuth-authorize passthrough: when iam.hanzo.ai/login/oauth/authorize 302s a
  // downstream app (console, chat, …) here, the original PKCE challenge + scope
  // ride the query string. Forward them so the code IAM mints is bound to the
  // app's verifier — hanzo.id is the login UI, IAM stays the OAuth backend.
  const codeChallenge = sp.get('code_challenge') ?? undefined
  const codeChallengeMethod = (sp.get('code_challenge_method') as 'S256' | 'plain' | null) ?? undefined
  const scope = sp.get('scope') ?? undefined
  const accent = brand.accentColor ?? '#ffffff'
  const marketing = marketingFor(tenant.orgId)
  const search = window.location.search

  return (
    <div className="hanzo-id-split">
      <section className="hanzo-id-split-form">
        <div className="hanzo-id-card">
          <header className="hanzo-id-card-head">
            <a href="/" aria-label={brand.name}>
              <BrandLogo brand={brand} tenant={tenant} height={36} />
            </a>
          </header>
          <h1 className="hanzo-id-card-title">Sign in to {brand.name}</h1>
          <LoginForm
            client={client}
            redirectUri={redirectUri}
            state={state}
            clientIdOverride={clientIdOverride ?? undefined}
            codeChallenge={codeChallenge}
            codeChallengeMethod={codeChallengeMethod}
            scope={scope}
          />
          <p className="hanzo-id-footer-links">
            <a href="/forget">Forgot password?</a>
            {signupEnabled ? (
              <>
                {' '}·{' '}
                <a href={`/signup${search}`}>Create account</a>
              </>
            ) : null}
          </p>
        </div>
      </section>

      <aside className="hanzo-id-split-brand">
        <MarketingPanel marketing={marketing} accent={accent} />
      </aside>
    </div>
  )
}
