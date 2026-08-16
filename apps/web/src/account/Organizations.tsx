import type { Account, Membership } from '@hanzo/id-auth'
import { Busy, Empty, Row, Section, Tag } from './ui'

/**
 * The orgs this account belongs to, and which one it is acting as.
 *
 * The list is IAM's, not the token's. Both exist — the access token carries an
 * `orgs` claim and that is what the edge authorizes `X-Org-Id` against — but a
 * claim is a snapshot taken when the token was minted, so a membership added
 * five minutes ago is invisible until the next refresh. Asking IAM is the
 * reading that cannot be stale, and the page reads it once for both the header's
 * switcher and this list.
 *
 * Switching is offered here AND in the header, and both call the same function:
 * the header's control is the shell's, which is what every other Hanzo surface
 * draws, so this page must not grow a second one of its own.
 */
export function Organizations({
  account,
  orgs,
  currentOrg,
  onSwitch,
}: {
  account: Account
  orgs: Membership[] | null
  currentOrg: string
  onSwitch: (org: string) => void
}) {
  return (
    <Section
      title="Organizations"
      describe="Where you are a member. The one you are acting as decides what the other Hanzo apps show you."
    >
      {orgs === null ? (
        <Busy />
      ) : orgs.length === 0 ? (
        <Empty>Only your own organization, {account.owner}.</Empty>
      ) : (
        orgs.map((m) => (
          <Row
            key={m.org}
            label={m.org}
            hint={m.org === account.owner ? 'Your home organization' : undefined}
            control={
              m.org === currentOrg ? (
                <Tag>Active</Tag>
              ) : (
                <button type="button" className="hanzo-id-linkbtn" onClick={() => onSwitch(m.org)}>
                  Switch
                </button>
              )
            }
          >
            <Tag>{m.role}</Tag>
          </Row>
        ))
      )}
    </Section>
  )
}
