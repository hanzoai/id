import { useEffect, useState } from 'react'
import type { IamIdentity } from '@hanzo/iam/react'
import { UserMenu, resolveIdentity } from '@hanzo/iam/react'
import type { BrandContract, OrgConfig } from '@hanzo/id-shared'
import type { AuthClient } from '@hanzo/id-auth'
import { Login } from './Login'
import { BrandHeader } from '../components/BrandHeader'
import { appsFor, billingFor } from '../marketing'

type Auth =
  | { s: 'loading' }
  | { s: 'anon' }
  | { s: 'authed'; identity: IamIdentity | null }

/**
 * Root portal (`/`). The portal IS the login surface, not a marketing hero:
 *
 *  - signed out → the actual `<Login>` form (GitHub/Google/email+password),
 *                 identical to `/login`. A bare sign-in here lands on
 *                 onboarding, then back on `/` authenticated.
 *  - signed in  → the apps launcher (the org's apps) + billing / sign-out.
 *
 * Auth is read same-origin from `/v1/iam/account` (cookie session;
 * `org.iamUrl` is the brand's own `*.id` host, so this is first-party and
 * the session cookie rides along). The `?signed_in=1` marker set by the
 * bare-login / onboarding-complete redirect is the authoritative "just
 * authenticated" signal when the cookie read hasn't propagated yet.
 */
export function Portal({
  client,
  brand,
  org,
}: {
  client: AuthClient
  brand: BrandContract
  org: OrgConfig
}) {
  const [auth, setAuth] = useState<Auth>({ s: 'loading' })

  useEffect(() => {
    let alive = true
    const justSignedIn = new URLSearchParams(window.location.search).get('signed_in') === '1'
    fetch(new URL('/v1/iam/account', org.iamUrl).toString(), {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then((r) => r.json())
      .then((b: Record<string, unknown>) => {
        if (!alive) return
        const d = b.data as Record<string, unknown> | undefined
        if (b.status === 'ok' && d && typeof d === 'object') {
          // `resolveIdentity` is the SAME name/avatar/initials resolution every
          // Hanzo surface shows, so the portal cannot disagree with the console
          // about who you are — and it never falls back to a raw uuid.
          setAuth({ s: 'authed', identity: resolveIdentity(d, {}) })
        } else {
          setAuth(justSignedIn ? { s: 'authed', identity: null } : { s: 'anon' })
        }
      })
      .catch(() => {
        if (alive) setAuth(justSignedIn ? { s: 'authed', identity: null } : { s: 'anon' })
      })
    return () => {
      alive = false
    }
  }, [org.iamUrl])

  if (auth.s === 'loading') {
    return (
      <div className="hanzo-id-page" style={{ minHeight: '40vh' }}>
        <div className="hanzo-id-spinner" style={{ borderTopColor: brand.accentColor ?? 'var(--primary)' }} />
      </div>
    )
  }

  // Signed out: the root IS the login form (no marketing hero).
  if (auth.s === 'anon') return <Login client={client} brand={brand} />

  // Signed in: the apps launcher.
  const apps = appsFor(org.orgId)
  const billingUrl = billingFor(org.orgId)
  const logoutUrl = client.logout(undefined, `${org.publicOrigin}/login`)

  return (
    <div className="hanzo-id-page hanzo-id-portal">
      <BrandHeader brand={brand} />
      <main>
        <h1>Your {brand.name} apps</h1>
        <div className="hanzo-id-apps">
          {apps.map((a) => (
            <a key={a.name} className="hanzo-id-applink" href={a.href}>
              <div className="hanzo-id-applink-name">
                <span>{a.name}</span>
                <span aria-hidden>↗</span>
              </div>
              <div className="hanzo-id-applink-desc">{a.description}</div>
            </a>
          ))}
        </div>
        {/* The ONE account control. This was a hand-rolled "Billing / Sign out"
            link row; every Hanzo surface mounts @hanzo/iam's UserMenu instead,
            so identity, billing and sign-out read and behave identically here,
            on hanzo.chat and in the console. The portal's session is its own
            cookie read rather than an IamProvider, which is exactly what the
            `identity` / `isAuthenticated` / `onSignOut` overrides are for.
            No `brand` prop: omitting `markSvg` would put the HANZO mark on
            lux.id and zoo.id, and this one image serves all four portals. */}
        <div className="hanzo-id-portal-account">
          <UserMenu
            identity={auth.identity}
            isAuthenticated
            usageUrl={billingUrl}
            usageLabel="Billing"
            onSignOut={() => { window.location.href = logoutUrl }}
          />
        </div>
      </main>
    </div>
  )
}
