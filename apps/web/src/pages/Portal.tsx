import { useEffect, useState } from 'react'
import type { IamIdentity } from '@hanzo/iam/react'
import { UserMenu, resolveIdentity } from '@hanzo/iam/react'
import { IdentityList, type HeldIdentity } from '@hanzo/id-auth'
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
 * Auth is read same-origin from `/v1/iam/get-account` (cookie session;
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
  // Every identity signed in on THIS browser, with the active one marked. The
  // portal is the account page, so this is where "see all users logged in",
  // "switch", and "log out of one of them" live — `hanzo auth list` / `use` /
  // `logout`, with the CLI's own words.
  const [held, setHeld] = useState<{ identities: readonly HeldIdentity[]; active: string }>({
    identities: [],
    active: '',
  })
  const [busy, setBusy] = useState(false)

  // Re-read after every mutation, never patch locally: the issuer owns the set,
  // and a switcher that believed its own optimistic copy would be a switcher
  // that can show the wrong person.
  function refresh() {
    void client.identities().then(setHeld)
  }
  useEffect(refresh, [client])

  useEffect(() => {
    let alive = true
    const justSignedIn = new URLSearchParams(window.location.search).get('signed_in') === '1'
    fetch(new URL('/v1/iam/get-account', org.iamUrl).toString(), {
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

  // Signed out — but "signed out" now has two shapes, and only one of them is
  // "nobody is here".
  //
  // Signing out the ACTIVE identity deliberately promotes nobody, so a browser
  // can hold a perfectly live identity while acting as none of them. Rendering
  // the credential form in that state asks a person to type a password they do
  // not need — the account they still hold is one click away. Send them to the
  // chooser instead, which is the SAME chooser `prompt=select_account` shows;
  // there is one account-picking screen and one URL that means "choose".
  if (auth.s === 'anon') {
    if (held.identities.length > 0) {
      window.location.replace('/login?prompt=select_account')
      return null
    }
    return <Login client={client} brand={brand} />
  }

  // Signed in: the apps launcher.
  const apps = appsFor(org.orgId)
  const billingUrl = billingFor(org.orgId)
  // No identity named: the issuer ends EVERY identity. That is what a bare
  // "Sign out" has to mean on a shared machine — leaving a second account live
  // because it merely was not the active one is a logout that reports success
  // while a session survives.
  const logoutUrl = client.logout(undefined, `${org.publicOrigin}/login`)

  // Switch. No credential is sent and none is needed: the selector names an
  // identity already inside the issuer's signed session cookie. A full reload
  // afterwards, because every panel on this page renders the ACTIVE identity's
  // data and a half-switched page is the wrong person's data on screen.
  function use(identity: string) {
    setBusy(true)
    void client
      .useIdentity({ identity, application: org.appName })
      .then(() => window.location.reload())
      .catch(() => setBusy(false))
  }

  // Sign ONE identity out, naming it. The others stay signed in — and if the one
  // signed out was the active one, the issuer promotes nobody, so the next page
  // asks who you are rather than silently becoming somebody else.
  function signOutOne(identity: string) {
    window.location.href = client.logout(undefined, `${org.publicOrigin}/`, identity)
  }

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
        {held.identities.length > 0 ? (
          <section className="hanzo-id-portal-identities" aria-label="Signed-in accounts">
            <h2>Signed in as</h2>
            <IdentityList
              identities={held.identities}
              active={held.active}
              busy={busy}
              onUse={use}
              onSignOut={signOutOne}
              /* Adding an account never drops the ones already here. The
                 chooser is where the second sign-in lands, so this hop asks for
                 it explicitly rather than letting a bare /login look like a
                 replacement. */
              onAdd={() => {
                window.location.href = '/login?prompt=select_account'
              }}
            />
            <p className="hanzo-id-identities-note">
              ● = active; <strong>owner</strong> is the billing org.{' '}
              <a href={logoutUrl}>Sign out of all accounts</a>
            </p>
          </section>
        ) : null}
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
