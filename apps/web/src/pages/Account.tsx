import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { OrgHeader } from '@hanzogui/shell'
import type { BrandContract, OrgConfig } from '@hanzo/id-shared'
import type { Account as Row, AuthClient, Membership } from '@hanzo/id-auth'
import { createAccountClient, createIam } from '@hanzo/id-auth'
import { BrandFooter } from '../components/BrandFooter'
import { Mark } from '../components/Mark'
import { Apps } from '../account/Apps'
import { Organizations } from '../account/Organizations'
import { Profile } from '../account/Profile'
import { Security } from '../account/Security'
import { SECTIONS, sectionOf, type SectionId } from '../account/section'

/**
 * The account surface: `/account`, and one path segment per section.
 *
 * SIGNED OUT IT HAS EXACTLY ONE CONTROL. This page is a relying party of the
 * issuer that serves it, so the way in is the issuer's own authorize leg and
 * nothing else — no credential form, no provider strip. Those live at `/login`,
 * which is the ISSUER's screen and the one place a credential is ever typed.
 * Two doors to the same session is how a phishing surface gets built by
 * accident.
 */

/** The selection every Hanzo surface reads. The SDK owns the key; this writes it. */
const ORG_KEY = 'hanzo_iam_current_org'

type State = { s: 'loading' } | { s: 'anon' } | { s: 'authed'; account: Row }

export function Account({
  client,
  brand,
  org,
}: {
  client: AuthClient
  brand: BrandContract
  org: OrgConfig
}) {
  const iam = useMemo(() => createIam(org), [org])

  /**
   * ONE token acquisition, however many calls ask for it.
   *
   * `getToken` is consulted per request and every consultation that reached the
   * network started its own sign-in leg — six authorize hops for one page load,
   * measured. The promise is the cache: concurrent callers share the attempt,
   * and a resolved null is remembered as "no token", not retried forever.
   */
  const token = useRef<Promise<string | null> | null>(null)
  const getToken = useCallback(() => {
    token.current ??= iam.getValidAccessToken().catch(() => null)
    return token.current
  }, [iam])

  const account = useMemo(() => createAccountClient({ org, getToken }), [org, getToken])
  const [state, setState] = useState<State>({ s: 'loading' })
  const [section, setSection] = useState<SectionId>(() => sectionOf(window.location.pathname))
  const [currentOrg, setCurrentOrg] = useState<string>(() => localStorage.getItem(ORG_KEY) ?? '')

  const [orgs, setOrgs] = useState<Membership[] | null>(null)

  useEffect(() => {
    let alive = true
    account
      .read()
      .then(async (row) => {
        if (!alive) return
        if (!row) {
          setState({ s: 'anon' })
          return
        }
        setState({ s: 'authed', account: row })
        // One read serves the header's switcher and the Organizations section;
        // two would be two answers to the same question.
        const mine = await account.memberships(`${row.owner}/${row.name}`).catch(() => [])
        if (alive) setOrgs(mine.length ? mine : [{ org: row.owner, role: row.isAdmin ? 'admin' : 'member' }])
      })
      .catch(() => alive && setState({ s: 'anon' }))
    return () => {
      alive = false
    }
  }, [account])

  // The address bar is the section, so Back works and a section can be linked.
  useEffect(() => {
    const onPop = () => setSection(sectionOf(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const go = useCallback((id: SectionId) => {
    window.history.pushState(null, '', id ? `/account/${id}` : '/account')
    setSection(id)
    window.scrollTo(0, 0)
  }, [])

  const switchOrg = useCallback((next: string) => {
    localStorage.setItem(ORG_KEY, next)
    setCurrentOrg(next)
    // A reload, because every other surface reads this once at boot: leaving the
    // page up would show one org in the header and another everywhere else.
    window.location.reload()
  }, [])

  if (state.s === 'loading') {
    return (
      <div className="hanzo-id-page">
        <div className="hanzo-id-spinner" style={{ borderTopColor: brand.accentColor ?? 'var(--primary)' }} />
      </div>
    )
  }

  if (state.s === 'anon') return <SignedOut brand={brand} org={org} />

  const row = state.account
  const active = currentOrg || row.owner
  const display = row.displayName || row.name

  // The shell's bar draws the Hanzo H-mark and has no brand slot, so it is
  // Hanzo's chrome and only Hanzo's. Every other brand this image serves keeps
  // the corner mark it already had — a shared header is worth having, but not at
  // the price of putting one company's mark on another company's sign-in.
  const chrome = org.orgId === 'hanzo'

  return (
    <>
      {chrome ? (
        <OrgHeader
          currentApp="Account"
          currentAppId="id"
          hideSettings
          user={{ name: display, email: row.email, avatar: row.avatar }}
          organizations={(orgs ?? []).map((m) => ({ id: m.org, name: m.org, role: m.role }))}
          currentOrgId={active}
          onOrgSwitch={switchOrg}
          onSignOut={() => {
            window.location.href = client.signOut(`${org.publicOrigin}/account`)
          }}
        />
      ) : (
        <Mark brand={brand} orgId={org.orgId} />
      )}

      <div className={`hanzo-id-page hanzo-id-account${chrome ? ' hanzo-id-account-chromed' : ''}`}>
        <main className="hanzo-id-account-main">
          <header className="hanzo-id-account-head">
            <h1>Account</h1>
            <p>
              {display} · {row.email || row.name}
            </p>
          </header>

          <nav className="hanzo-id-account-nav" aria-label="Account sections">
            {SECTIONS.map((s) => (
              <button
                key={s.id || 'profile'}
                type="button"
                className="hanzo-id-account-tab"
                aria-current={section === s.id ? 'page' : undefined}
                onClick={() => go(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>

          <div className="hanzo-id-account-body">
            {section === '' ? <Profile account={row} client={account} /> : null}
            {section === 'security' ? (
              <Security
                account={row}
                client={account}
                auth={client}
                signOutHref={client.signOut(`${org.publicOrigin}/account`)}
              />
            ) : null}
            {section === 'organizations' ? (
              <Organizations account={row} orgs={orgs} currentOrg={active} onSwitch={switchOrg} />
            ) : null}
            {section === 'apps' ? <Apps org={org} /> : null}
          </div>
        </main>
        <BrandFooter brand={brand} org={org} />
      </div>
    </>
  )
}

/** One control, and it is the issuer's. */
function SignedOut({ brand, org }: { brand: BrandContract; org: OrgConfig }) {
  const [busy, setBusy] = useState(false)
  const label = brand.name ? `Continue with ${brand.name} ID` : 'Continue'

  return (
    <div className="hanzo-id-page hanzo-id-account-anon">
      <main>
        <h1>Your account</h1>
        <p className="hanzo-id-card-desc">Sign in to manage your profile, security and organizations.</p>
        <button
          type="button"
          className="hanzo-id-btn"
          aria-disabled={busy}
          onClick={() => {
            if (busy) return
            setBusy(true)
            // The issuer decides what proof it wants — a live session finishes
            // this without a screen, and everything else is its business.
            void createIam(org).signinRedirect()
          }}
        >
          {busy ? 'Taking you there…' : label}
        </button>
      </main>
      <BrandFooter brand={brand} org={org} />
    </div>
  )
}
