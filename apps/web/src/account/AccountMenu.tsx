import { useEffect, useId, useRef, useState } from 'react'
import type { BrowserAccount } from '@hanzo/id-auth'

/**
 * The account chip, top right: who is signed in here, and the way to every other
 * account this browser holds.
 *
 * The list is IAM's (`GET /v1/iam/accounts`), current first. Choosing another
 * account makes it current at IAM (`PUT /v1/iam/accounts`) — nobody is signed in
 * or out, and each account keeps its own org and roles. Adding one asks IAM for
 * a fresh credential. Signing out ends this account alone (`logout_hint`), or
 * every account here.
 *
 * It renders what it is handed and decides nothing: the page owns the reads and
 * the navigations, so this is the one control and the page is the one policy.
 */
export function AccountMenu({
  accounts,
  orgs,
  currentOrg,
  onSwitch,
  onOrgSwitch,
  onAdd,
  onSignOut,
  onSignOutAll,
}: {
  /** Everyone signed in on this browser, current first. Never empty. */
  accounts: readonly BrowserAccount[]
  /** The current account's organizations, when read. */
  orgs?: readonly { id: string; role?: string }[]
  currentOrg?: string
  onSwitch: (account: BrowserAccount) => void
  onOrgSwitch?: (org: string) => void
  onAdd: () => void
  onSignOut: (account: BrowserAccount) => void
  onSignOutAll: () => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const panel = useId()
  const [current, ...others] = accounts

  // A menu closes on the way out: a click elsewhere, or Escape.
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  if (!current) return null
  const many = accounts.length > 1

  return (
    <div className="id-acct" ref={root}>
      <button
        type="button"
        className="id-acct-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panel}
        aria-label={`Account: ${who(current)}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar account={current} />
        <span className="id-acct-who">
          <span className="id-acct-name">{who(current)}</span>
          {current.email ? <span className="id-acct-email">{current.email}</span> : null}
        </span>
        <span className="id-acct-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div className="id-acct-panel" id={panel} role="menu" aria-label="Accounts">
          <div className="id-acct-section" role="group" aria-label="Signed in">
            <div className="id-acct-row id-acct-current" role="menuitemradio" aria-checked="true">
              <Avatar account={current} />
              <span className="id-acct-who">
                <span className="id-acct-name">{who(current)}</span>
                <span className="id-acct-email">{current.email || `${current.owner}/${current.name}`}</span>
              </span>
              <span className="id-acct-check" aria-hidden="true">
                ✓
              </span>
            </div>
            {others.map((a) => (
              <button
                key={a.sub}
                type="button"
                className="id-acct-row"
                role="menuitemradio"
                aria-checked="false"
                onClick={() => {
                  setOpen(false)
                  onSwitch(a)
                }}
              >
                <Avatar account={a} />
                <span className="id-acct-who">
                  <span className="id-acct-name">{who(a)}</span>
                  <span className="id-acct-email">{a.email || `${a.owner}/${a.name}`}</span>
                </span>
              </button>
            ))}
            <button
              type="button"
              className="id-acct-item"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onAdd()
              }}
            >
              Add another account
            </button>
          </div>

          {orgs && orgs.length > 0 && onOrgSwitch ? (
            <div className="id-acct-section" role="group" aria-label="Organizations">
              <div className="id-acct-label">Organizations</div>
              {orgs.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className="id-acct-item"
                  role="menuitemradio"
                  aria-checked={o.id === currentOrg}
                  onClick={() => {
                    setOpen(false)
                    if (o.id !== currentOrg) onOrgSwitch(o.id)
                  }}
                >
                  <span>{o.id}</span>
                  {o.id === currentOrg ? <span aria-hidden="true">✓</span> : null}
                </button>
              ))}
            </div>
          ) : null}

          <div className="id-acct-section" role="group" aria-label="Sign out">
            <button
              type="button"
              className="id-acct-item"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onSignOut(current)
              }}
            >
              {many ? `Sign out of ${current.email || who(current)}` : 'Sign out'}
            </button>
            {many ? (
              <button
                type="button"
                className="id-acct-item"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onSignOutAll()
                }}
              >
                Sign out of all accounts
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** The name a person is shown by: their display name, else their username. */
function who(a: BrowserAccount): string {
  return a.displayName || a.name
}

/** The account's picture, or its initial when it has none or the picture fails to load. */
function Avatar({ account }: { account: BrowserAccount }) {
  const [broken, setBroken] = useState(false)
  return account.avatar && !broken ? (
    <img className="id-acct-avatar" src={account.avatar} alt="" onError={() => setBroken(true)} />
  ) : (
    <span className="id-acct-avatar" aria-hidden="true">
      {who(account).slice(0, 1).toUpperCase()}
    </span>
  )
}
