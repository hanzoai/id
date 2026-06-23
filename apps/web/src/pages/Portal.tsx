import { useEffect, useState } from 'react'
import type { BrandContract, TenantConfig } from '@hanzo/id-shared'
import type { AuthClient } from '@hanzo/id-auth'
import { Login } from './Login'
import { BrandHeader } from '../components/BrandHeader'
import { appsFor, billingFor } from '../marketing'

type Auth =
  | { s: 'loading' }
  | { s: 'anon' }
  | { s: 'authed'; name?: string; email?: string }

/**
 * Root portal (`/`). The portal IS the login surface, not a marketing hero:
 *
 *  - signed out → the actual `<Login>` form (GitHub/Google/email+password),
 *                 identical to `/login`. A bare sign-in here lands on
 *                 onboarding, then back on `/` authenticated.
 *  - signed in  → the apps launcher (the org's apps) + billing / sign-out.
 *
 * Auth is read same-origin from `/v1/iam/get-account` (cookie session;
 * `tenant.iamUrl` is the brand's own `*.id` host, so this is first-party and
 * the session cookie rides along). The `?signed_in=1` marker set by the
 * bare-login / onboarding-complete redirect is the authoritative "just
 * authenticated" signal when the cookie read hasn't propagated yet.
 */
export function Portal({
  client,
  brand,
  tenant,
}: {
  client: AuthClient
  brand: BrandContract
  tenant: TenantConfig
}) {
  const [auth, setAuth] = useState<Auth>({ s: 'loading' })

  useEffect(() => {
    let alive = true
    const justSignedIn = new URLSearchParams(window.location.search).get('signed_in') === '1'
    fetch(new URL('/v1/iam/get-account', tenant.iamUrl).toString(), {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then((r) => r.json())
      .then((b: Record<string, unknown>) => {
        if (!alive) return
        const d = b.data as Record<string, unknown> | undefined
        if (b.status === 'ok' && d && typeof d === 'object') {
          setAuth({ s: 'authed', name: str(d.displayName) ?? str(d.name), email: str(d.email) })
        } else {
          setAuth(justSignedIn ? { s: 'authed' } : { s: 'anon' })
        }
      })
      .catch(() => {
        if (alive) setAuth(justSignedIn ? { s: 'authed' } : { s: 'anon' })
      })
    return () => {
      alive = false
    }
  }, [tenant.iamUrl])

  if (auth.s === 'loading') {
    return (
      <div className="hanzo-id-page" style={{ minHeight: '40vh' }}>
        <div className="hanzo-id-spinner" style={{ borderTopColor: brand.accentColor ?? '#fff' }} />
      </div>
    )
  }

  // Signed out: the root IS the login form (no marketing hero).
  if (auth.s === 'anon') return <Login client={client} brand={brand} />

  // Signed in: the apps launcher.
  const apps = appsFor(tenant.orgId)
  const billingUrl = billingFor(tenant.orgId)
  const logoutUrl = client.logout(undefined, `${tenant.publicOrigin}/login`)

  return (
    <div className="hanzo-id-page hanzo-id-portal">
      <BrandHeader brand={brand} />
      <main style={{ width: '100%', maxWidth: 760 }}>
        <h1>Your {brand.name} apps</h1>
        {auth.email ? <p className="lede">{auth.email}</p> : null}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
            gap: 12,
            marginTop: 24,
          }}
        >
          {apps.map((a) => (
            <a
              key={a.name}
              href={a.href}
              style={{
                display: 'block',
                padding: '16px 18px',
                border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: 12,
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <div style={{ fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
                <span>{a.name}</span>
                <span aria-hidden style={{ opacity: 0.5 }}>↗</span>
              </div>
              <div style={{ opacity: 0.6, fontSize: 13, marginTop: 4 }}>{a.description}</div>
            </a>
          ))}
        </div>
        <div style={{ marginTop: 28, display: 'flex', gap: 18 }}>
          <a className="hanzo-id-linkbtn" href={billingUrl}>Billing</a>
          <a className="hanzo-id-linkbtn" href={logoutUrl}>Sign out</a>
        </div>
      </main>
    </div>
  )
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}
