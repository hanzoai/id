import { useEffect, useState } from 'react'
import type { IamIdentity } from '@hanzo/iam/react'
import { Appearance } from '@hanzo/appearance'
import { UserMenu, resolveIdentity } from '@hanzo/iam/react'
import type { BrandContract, OrgConfig } from '@hanzo/id-shared'
import type { AuthClient } from '@hanzo/id-auth'
import { Login } from './Login'
import { BrandFooter } from '../components/BrandFooter'
import { appsFor, billingFor } from '../marketing'

type Auth =
  | { s: 'loading' }
  | { s: 'anon' }
  | { s: 'authed'; identity: IamIdentity | null }
  // IAM did not answer who is signed in. Distinct from `anon`, which is IAM
  // answering that nobody is — drawing the login form for this one hides a
  // broken read behind a screen that looks like ordinary signed-out.
  | { s: 'unreadable'; why: string }

/**
 * Root portal (`/`). The portal IS the login surface, not a marketing hero:
 *
 *  - signed out → the actual `<Login>` form (GitHub/Google/email+password),
 *                 identical to `/login`. A bare sign-in here lands on
 *                 onboarding, then back on `/` authenticated.
 *  - signed in  → the apps launcher (the org's apps) + billing / sign-out.
 *
 * Auth is read through `client.getAccount()` — the ONE reader of the IAM
 * session in this package, so the portal, the device page and the MFA form
 * cannot disagree about the address or about what its answers mean (cookie
 * session; `org.iamUrl` is the brand's own `*.id` host, so this is first-party
 * and the session cookie rides along). The `?signed_in=1` marker set by the
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
    client
      .getAccount()
      .then((account) => {
        if (!alive) return
        if (account) {
          // `resolveIdentity` is the SAME name/avatar/initials resolution every
          // Hanzo surface shows, so the portal cannot disagree with the console
          // about who you are — and it never falls back to a raw uuid.
          setAuth({ s: 'authed', identity: resolveIdentity({ ...account }, {}) })
        } else {
          setAuth(justSignedIn ? { s: 'authed', identity: null } : { s: 'anon' })
        }
      })
      .catch((e: unknown) => {
        if (alive) setAuth({ s: 'unreadable', why: e instanceof Error ? e.message : String(e) })
      })
    return () => {
      alive = false
    }
  }, [client])

  if (auth.s === 'loading') {
    return (
      <div className="hanzo-id-page" style={{ minHeight: '40vh' }}>
        <div className="hanzo-id-spinner" style={{ borderTopColor: brand.accentColor ?? 'var(--primary)' }} />
      </div>
    )
  }

  // The read itself failed. Say so and offer the one action that can help,
  // rather than drawing a login form that would send an already-signed-in person
  // around a loop this page cannot report.
  if (auth.s === 'unreadable') {
    return (
      <div className="hanzo-id-page">
        <main>
          <h1>We could not check whether you are signed in</h1>
          <p role="alert" className="hanzo-id-error">{auth.why}</p>
          <a href={`${org.publicOrigin}/login`}>Go to sign in</a>
        </main>
        <BrandFooter brand={brand} org={client.org} />
      </div>
    )
  }

  // Signed out: the root IS the login form (no marketing hero).
  if (auth.s === 'anon') return <Login client={client} brand={brand} />

  // Signed in: the apps launcher.
  const apps = appsFor(org.orgId)
  // undefined for a brand with no billing host — UserMenu renders the row only when
  // it has a URL, so the tile disappears rather than pointing at a dead hostname.
  const billingUrl = billingFor(org.orgId)
  // signOut, not logout: the latter only builds the IdP URL and leaves this
  // browser's `hanzo_iam_*` keys in place, so the token string outlived the
  // session it named. Called on click, not at render — it clears storage.

  return (
    <div className="hanzo-id-page hanzo-id-portal">
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
        {/* How this reads, set where the person always is. Appearance was a
            per-origin setting kept in each site's localStorage, so one person had
            four of them and the one place they always pass through had none. The
            panel writes to the account here, because this host IS the session:
            no bearer to mint, and the choice is on every surface next time. */}
        <div className="hanzo-id-portal-appearance">
          <Appearance account={{ base: org.iamUrl }} />
        </div>
        <div className="hanzo-id-portal-account">
          <UserMenu
            identity={auth.identity}
            isAuthenticated
            usageUrl={billingUrl}
            usageLabel="Billing"
            onSignOut={() => { window.location.href = client.signOut(`${org.publicOrigin}/login`) }}
          />
        </div>
      </main>
      <BrandFooter brand={brand} org={client.org} />
    </div>
  )
}
