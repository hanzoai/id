import type { HeldIdentity } from '../types'

/**
 * THE ACCOUNT CHOOSER — every identity this browser is signed in as, the active
 * one marked, each one a click away.
 *
 * It is `hanzo auth list` with a pointer. The CLI has printed exactly this for
 * releases:
 *
 *     * hanzo/z
 *       hanzo/a
 *     (* = active; owner is the billing org)
 *
 * and the browser simply never had it, which is why a human holding z@ and a@
 * had to sign out of one to reach the other. One model, two front-ends — so the
 * words here are the CLI's, not a second vocabulary for the same thing.
 *
 * It renders a LIST and nothing else. It fetches nothing, decides nothing and
 * holds no state: the caller owns the set (the issuer is the only thing that
 * knows it) and owns what a click means, because the same list is the chooser
 * on the login page and the switcher on the account page.
 */
export interface IdentityListProps {
  /** Every identity the browser holds, in the order they were added. */
  readonly identities: readonly HeldIdentity[]
  /** `owner/name` of the active identity, or '' when none is. */
  readonly active: string
  /** Select an identity — `hanzo auth use`. */
  readonly onUse: (identity: string) => void
  /** Sign in as somebody else, keeping everyone already here. */
  readonly onAdd?: () => void
  /** Sign ONE identity out. Omitted on the login-page chooser, where the job is
   *  to pick, not to prune. */
  readonly onSignOut?: (identity: string) => void
  /** Disable every control while a selection is in flight. */
  readonly busy?: boolean
}

export function IdentityList({ identities, active, onUse, onAdd, onSignOut, busy }: IdentityListProps) {
  return (
    <ul className="hanzo-id-identities" data-testid="identity-list">
      {identities.map((id) => {
        const isActive = id.identity === active
        return (
          <li
            key={id.identity}
            className={isActive ? 'hanzo-id-identity is-active' : 'hanzo-id-identity'}
            data-identity={id.identity}
            data-active={isActive ? 'true' : 'false'}
          >
            <button
              type="button"
              className="hanzo-id-identity-pick"
              disabled={busy}
              onClick={() => onUse(id.identity)}
              /* The accessible name says WHICH identity and whether it is the
                 one in use — the two facts the whole control exists to convey,
                 and the two a screen reader would otherwise have to infer from
                 a colour. */
              aria-label={`${isActive ? 'Active: ' : 'Switch to '}${id.displayName ?? id.name} (${id.identity})`}
              aria-current={isActive ? 'true' : undefined}
            >
              <span className="hanzo-id-identity-mark" aria-hidden>
                {isActive ? '●' : '○'}
              </span>
              <span className="hanzo-id-identity-who">
                <span className="hanzo-id-identity-name">{id.displayName ?? id.name}</span>
                <span className="hanzo-id-identity-email">{id.email ?? id.identity}</span>
              </span>
              {/* `owner` is the billing org, and it is read from the identity's
                  OWN user row — the same human can exist in two orgs, so this is
                  the field that tells two otherwise identical rows apart. */}
              <span className="hanzo-id-identity-org" title="Billing organization">
                {id.owner}
              </span>
            </button>
            {onSignOut ? (
              <button
                type="button"
                className="hanzo-id-identity-out"
                disabled={busy}
                onClick={() => onSignOut(id.identity)}
                aria-label={`Sign out ${id.identity}`}
              >
                Sign out
              </button>
            ) : null}
          </li>
        )
      })}
      {onAdd ? (
        <li className="hanzo-id-identity hanzo-id-identity-add">
          <button type="button" className="hanzo-id-identity-pick" disabled={busy} onClick={onAdd}>
            <span className="hanzo-id-identity-mark" aria-hidden>
              +
            </span>
            <span className="hanzo-id-identity-who">
              <span className="hanzo-id-identity-name">Use another account</span>
              {/* Said out loud because it is the thing people do not believe:
                  the accounts already here stay signed in. */}
              <span className="hanzo-id-identity-email">Everyone above stays signed in</span>
            </span>
          </button>
        </li>
      ) : null}
    </ul>
  )
}
