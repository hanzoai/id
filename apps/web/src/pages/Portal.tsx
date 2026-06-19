import { useEffect, useState } from 'react'
import type { BrandContract, TenantConfig } from '@hanzo/id-shared'
import type { AuthClient } from '@hanzo/id-auth'
import { BrandLogo } from '../components/BrandLogo'
import { appsFor, billingFor } from '../marketing'

interface SessionUser {
  readonly id: string
  readonly name?: string
  readonly displayName?: string
  readonly email?: string
  readonly avatar?: string
}

type AuthState = { status: 'loading' } | { status: 'anon' } | { status: 'authed'; user: SessionUser }

/**
 * Post-login portal. Detects the IAM session via the same-origin
 * `/v1/iam/get-account` proxy (cookie-scoped, `credentials: 'include'`):
 *
 *  - signed in  → the apps launcher ("all the apps") + account/billing cards,
 *                 restored from the legacy `account` page.
 *  - signed out → the brand hero with sign-in / create-account CTAs.
 *
 * No token juggling in localStorage — the portal is a cookie-session OIDC
 * provider, so the session lives in the IAM cookie and we just read it.
 */
export function Portal({
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
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' })

  useEffect(() => {
    let alive = true
    // `?signed_in=1` is set by the bare-portal login flow the moment the IAM
    // session cookie is established this tab. It's our authoritative "just
    // authenticated" signal; `get-account` is the richer-but-best-effort source
    // for the user's name/email/avatar.
    const justSignedIn = new URLSearchParams(window.location.search).get('signed_in') === '1'
    fetch(new URL('/v1/iam/get-account', tenant.publicOrigin).toString(), {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then((r) => r.json())
      .then((body: Record<string, unknown>) => {
        if (!alive) return
        const d = body.data as Record<string, unknown> | undefined
        if (body.status === 'ok' && d && typeof d === 'object') {
          setAuth({
            status: 'authed',
            user: {
              id: String(d.id ?? d.name ?? ''),
              name: typeof d.name === 'string' ? d.name : undefined,
              displayName: typeof d.displayName === 'string' ? d.displayName : undefined,
              email: typeof d.email === 'string' ? d.email : undefined,
              avatar: typeof d.avatar === 'string' ? d.avatar : undefined,
            },
          })
        } else if (justSignedIn) {
          setAuth({ status: 'authed', user: { id: '' } })
        } else {
          setAuth({ status: 'anon' })
        }
      })
      .catch(() => {
        if (!alive) return
        setAuth(justSignedIn ? { status: 'authed', user: { id: '' } } : { status: 'anon' })
      })
    return () => {
      alive = false
    }
  }, [tenant.publicOrigin])

  if (auth.status === 'loading') {
    return (
      <div className="hanzo-id-loading">
        <div className="hanzo-id-spinner" style={{ borderTopColor: brand.accentColor ?? '#fff' }} />
      </div>
    )
  }

  if (auth.status === 'anon') {
    return (
      <div className="hanzo-id-page hanzo-id-portal">
        <header className="hanzo-id-brand-header">
          <a href="/" aria-label={brand.name}>
            <BrandLogo brand={brand} tenant={tenant} height={32} />
          </a>
        </header>
        <main>
          <h1>Welcome to {brand.name}</h1>
          <p className="lede">{brand.description}</p>
          <div className="hanzo-id-cta-row">
            <a className="hanzo-id-btn primary" href="/login">Sign in</a>
            {signupEnabled ? <a className="hanzo-id-btn" href="/signup">Create account</a> : null}
          </div>
        </main>
      </div>
    )
  }

  const { user } = auth
  const apps = appsFor(tenant.orgId)
  const billingUrl = billingFor(tenant.orgId)
  const display = user.displayName || user.name || user.email || 'Account'
  const logoutUrl = client.logout(undefined, tenant.publicOrigin + '/login')

  return (
    <div className="hanzo-id-portal-authed">
      <nav className="hanzo-id-nav">
        <a href="/" aria-label={brand.name}>
          <BrandLogo brand={brand} tenant={tenant} height={28} />
        </a>
        <div className="hanzo-id-nav-links">
          <a href={billingUrl}>Billing</a>
          <a href={logoutUrl}>Sign out</a>
        </div>
      </nav>

      <div className="hanzo-id-portal-body">
        <div className="hanzo-id-profile">
          {user.avatar ? (
            <img className="hanzo-id-profile-avatar" src={user.avatar} alt="" />
          ) : (
            <div
              className="hanzo-id-profile-avatar hanzo-id-profile-avatar-fallback"
              style={{ color: brand.accentColor ?? '#fff' }}
            >
              {display[0]?.toUpperCase()}
            </div>
          )}
          <div>
            <h1>{display}</h1>
            {user.email ? <p className="lede">{user.email}</p> : null}
          </div>
        </div>

        <h2 className="hanzo-id-section-title">{brand.name} apps</h2>
        <div className="hanzo-id-apps-grid">
          {apps.map((app) => (
            <a key={app.name} className="hanzo-id-app-card" href={app.href}>
              <div className="hanzo-id-app-card-head">
                <span className="hanzo-id-app-name">{app.name}</span>
                <span className="hanzo-id-app-arrow" aria-hidden="true">↗</span>
              </div>
              <p className="hanzo-id-app-desc">{app.description}</p>
            </a>
          ))}
        </div>

        <div className="hanzo-id-portal-footer">
          <a className="hanzo-id-muted-link" href={brand.appDomain ? `https://${brand.appDomain}` : '/'}>
            ← Back to {brand.name}
          </a>
          <a className="hanzo-id-btn ghost" href={logoutUrl}>Sign out</a>
        </div>
      </div>
    </div>
  )
}
