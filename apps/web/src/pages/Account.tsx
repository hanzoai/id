import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { OrgHeader } from '@hanzogui/shell'
import type { Brand, Org } from '@hanzo/id-shared'
import type { Account as Row, AuthClient, BrowserAccount, Membership } from '@hanzo/id-auth'
import { createAccountClient, createIam } from '@hanzo/id-auth'
import { BrandFooter } from '../components/BrandFooter'
import { Mark } from '../components/Mark'
import { AccountMenu } from '../account/AccountMenu'
import { Apps } from '../account/Apps'
import { Organizations } from '../account/Organizations'
import { Profile } from '../account/Profile'
import { Security } from '../account/Security'
import { SECTIONS, sectionOf, type SectionId } from '../account/section'
import { RETURN_KEY } from '../route'

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
const CURRENT_ORG = 'hanzo_iam_current_org'

type State = { s: 'loading' } | { s: 'anon' } | { s: 'authed'; account: Row }

export function Account({
  client,
  brand,
  org,
}: {
  client: AuthClient
  brand: Brand
  org: Org
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
  const [currentOrg, setCurrentOrg] = useState<string>(() => localStorage.getItem(CURRENT_ORG) ?? '')

  const [orgs, setOrgs] = useState<Membership[] | null>(null)
  // Everyone signed in on this browser, current first: what the chip lists.
  const [signedIn, setSignedIn] = useState<BrowserAccount[]>([])

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
        void client.accounts().then((list) => alive && setSignedIn(list))
        // One read serves the header's switcher and the Organizations section;
        // two would be two answers to the same question.
        const mine = await account.memberships(`${row.owner}/${row.name}`).catch(() => [])
        if (alive) setOrgs(mine.length ? mine : [{ org: row.owner, role: row.isAdmin ? 'admin' : 'member' }])
      })
      .catch(() => alive && setState({ s: 'anon' }))
    return () => {
      alive = false
    }
  }, [account, client])

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
    localStorage.setItem(CURRENT_ORG, next)
    setCurrentOrg(next)
    // A reload, because every other surface reads this once at boot: leaving the
    // page up would show one org in the header and another everywhere else.
    window.location.reload()
  }, [])

  // Another account becomes current at IAM. The token this page holds names the
  // one that was, so it is dropped before the reload reads the account again.
  const switchAccount = useCallback(
    async (to: BrowserAccount) => {
      if (!(await client.switchAccount(to.sub))) return
      client.forget()
      window.location.reload()
    },
    [client],
  )

  // A new sign-in, on top of the ones here: IAM asks for a credential however
  // many sessions this browser holds, and the sign-in comes back to this page.
  const addAccount = useCallback(() => {
    try {
      sessionStorage.setItem(RETURN_KEY, window.location.pathname)
    } catch {
      // No session storage: the sign-in lands where a bare one always has.
    }
    void iam.signinRedirect({ additionalParams: { prompt: 'login' } })
  }, [iam])

  const signOut = useCallback(
    (who?: BrowserAccount) => {
      window.location.href = client.signOut(`${org.publicOrigin}/account`, who?.sub)
    },
    [client, org],
  )

  if (state.s === 'loading') {
    return (
      <div className="id-page">
        <div className="id-spinner" style={{ borderTopColor: brand.accentColor ?? 'var(--primary)' }} />
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

  // The chip lists IAM's accounts; until they are read, the one this page
  // already holds stands in, so a signed-in page is never without the chip.
  const here: BrowserAccount[] = signedIn.length
    ? signedIn
    : [{ sub: row.id, owner: row.owner, name: row.name, displayName: row.displayName, email: row.email, avatar: row.avatar }]
  const menu = (
    <AccountMenu
      accounts={here}
      orgs={(orgs ?? []).map((m) => ({ id: m.org, role: m.role }))}
      currentOrg={active}
      onSwitch={(to) => void switchAccount(to)}
      onOrgSwitch={switchOrg}
      onAdd={addAccount}
      onSignOut={signOut}
      onSignOutAll={() => signOut()}
    />
  )

  return (
    <>
      {chrome ? (
        <OrgHeader
          currentApp="Account"
          currentAppId="id"
          hideSettings
          user={{ name: display, email: row.email, avatar: row.avatar }}
          account={menu}
        />
      ) : (
        <>
          <Mark brand={brand} orgId={org.orgId} />
          <div className="id-acct-corner">{menu}</div>
        </>
      )}

      <div className={`id-page id-account${chrome ? ' id-account-chromed' : ''}`}>
        <main className="id-account-main">
          <header className="id-account-head">
            <h1>Account</h1>
            <p>
              {display} · {row.email || row.name}
            </p>
          </header>

          <nav className="id-account-nav" aria-label="Account sections">
            {SECTIONS.map((s) => (
              <button
                key={s.id || 'profile'}
                type="button"
                className="id-account-tab"
                aria-current={section === s.id ? 'page' : undefined}
                onClick={() => go(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>

          <div className="id-account-body">
            {section === '' ? <Profile account={row} client={account} /> : null}
            {section === 'security' ? (
              <Security
                account={row}
                client={account}
                auth={client}
                onSignOut={() => signOut()}
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
function SignedOut({ brand, org }: { brand: Brand; org: Org }) {
  const [busy, setBusy] = useState(false)
  const label = brand.name ? `Continue with ${brand.name} ID` : 'Continue'

  return (
    <div className="id-page id-account-anon">
      <main>
        <h1>Your account</h1>
        <p className="id-card-desc">Sign in to manage your profile, security and organizations.</p>
        <button
          type="button"
          className="id-btn"
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
