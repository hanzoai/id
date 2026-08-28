import type { Org } from '@hanzo/id-shared'
import { Empty, Section } from './ui'
import { appsFor, billingFor } from '../marketing'

/**
 * Everything this account opens, and where the money is.
 *
 * ORDER IS THE CATALOGUE'S, NOT YOUR HISTORY. Ordering by recent sign-in needs a
 * per-user, per-application timestamp and IAM keeps none: `lastSigninTime` is a
 * column with no writer, no login writes an audit row, and the session row is
 * per-application and admin-only to read. A list sorted by a value that is
 * always empty is a list in arbitrary order wearing a promise, so this says what
 * it actually is.
 */
export function Apps({ org }: { org: Org }) {
  const apps = appsFor(org.orgId)
  const billing = billingFor(org.orgId) ?? org.payUrl

  return (
    <>
      <Section title="Applications" describe="Everything your account opens.">
        {apps.length === 0 ? (
          <Empty>No applications are listed for this organization.</Empty>
        ) : (
          <div className="hanzo-id-apps">
            {apps.map((a) => (
              <a className="hanzo-id-applink" key={a.href} href={a.href}>
                <span className="hanzo-id-applink-name">{a.name}</span>
                <span className="hanzo-id-applink-desc">{a.description}</span>
              </a>
            ))}
          </div>
        )}
      </Section>

      <Section title="Billing" describe="Plans, payment methods, invoices and usage.">
        {billing ? (
          <a className="hanzo-id-btn" href={billing}>
            Open billing
          </a>
        ) : (
          <Empty>This organization has no billing surface.</Empty>
        )}
      </Section>
    </>
  )
}
