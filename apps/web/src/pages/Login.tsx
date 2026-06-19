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
