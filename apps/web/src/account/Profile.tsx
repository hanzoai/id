import { useCallback, useEffect, useId, useState } from 'react'
import type { Account, AccountClient, Consent } from '@hanzo/id-auth'
import { Alert } from '@hanzo/id-auth'
import { Busy, Done, Fixed, Row, Section, Toggle } from './ui'

/**
 * Who you are, and the two answers about your data that IAM lets you change.
 *
 * The identity fields are READ. IAM has no self-service write for them: the
 * entity verb (`update-user`) is admin CRUD and refuses a regular user on their
 * OWN row by design, so that a self-write cannot carry `isAdmin` or
 * `organization` with it. Rendering eight disabled inputs would dress that up as
 * a form that is merely busy; one sentence saying where the change is made is
 * the honest shape until IAM opens a bounded profile door.
 *
 * Consent is different and genuinely self-scoped: `PUT /v1/iam/consent` takes
 * the subject from the caller, never from a body field, because an answer
 * somebody else can give on your behalf is not consent.
 */
export function Profile({ account, client }: { account: Account; client: AccountClient }) {
  const [consent, setConsent] = useState<Consent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState<keyof Consent | null>(null)
  const errorId = useId()

  useEffect(() => {
    let alive = true
    client
      .consent()
      .then((c) => alive && setConsent(c))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [client])

  const answer = useCallback(
    async (key: keyof Consent, value: boolean) => {
      setBusy(key)
      setError(null)
      setSaved(null)
      try {
        await client.saveConsent({ [key]: value })
        // Read back rather than assume: the server owns this record, and a write
        // that silently did nothing should not leave the switch looking moved.
        setConsent(await client.consent())
        setSaved('Saved.')
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [client],
  )

  const joined = account.createdTime ? new Date(account.createdTime) : null

  return (
    <>
      <Section
        title="Profile"
        describe={`Your identity across every ${account.owner} service.`}
      >
        <Row label="Photo">
          {account.avatar ? (
            <img className="hanzo-id-avatar" src={account.avatar} alt="" />
          ) : (
            <span className="hanzo-id-avatar hanzo-id-avatar-empty" aria-hidden="true">
              {(account.displayName || account.name).slice(0, 1).toUpperCase()}
            </span>
          )}
        </Row>
        <Row label="Name">
          <Fixed value={account.displayName} />
        </Row>
        <Row label="Username">
          <Fixed value={account.name} />
        </Row>
        <Row label="Email" hint={account.email && !account.emailVerified ? 'Unverified' : undefined}>
          <Fixed value={account.email} />
        </Row>
        <Row label="Phone">
          <Fixed value={account.phone ? `${account.countryCode ? `+${account.countryCode} ` : ''}${account.phone}` : ''} />
        </Row>
        <Row label="Organization">
          <Fixed value={account.owner} />
        </Row>
        <Row label="Member since">
          <Fixed value={joined && !Number.isNaN(joined.valueOf()) ? joined.toLocaleDateString() : ''} absent="Unknown" />
        </Row>
        <p className="hanzo-id-note">
          Name, email and photo are held on your organization&rsquo;s record. An administrator of{' '}
          {account.owner} can change them; this page cannot yet, and will say so rather than
          appear to save.
        </p>
      </Section>

      <Section
        title="Your data"
        describe="What Hanzo may do with what you send it. Either answer can be changed at any time."
      >
        {loading ? (
          <Busy />
        ) : (
          <>
            <Row
              label="Improve the models"
              hint="Lets your conversations be used for training."
              control={
                <Toggle
                  label="Improve the models"
                  checked={consent?.training === true}
                  busy={busy === 'training'}
                  onChange={(next) => void answer('training', next)}
                />
              }
            >
              <span className="hanzo-id-absent">
                {consent?.training === null ? 'Not answered' : consent?.training ? 'Allowed' : 'Declined'}
              </span>
            </Row>
            <Row
              label="Product analytics"
              hint="Counts what gets used, so the rough edges are findable."
              control={
                <Toggle
                  label="Product analytics"
                  checked={consent?.insights !== false}
                  busy={busy === 'insights'}
                  onChange={(next) => void answer('insights', next)}
                />
              }
            >
              <span className="hanzo-id-absent">{consent?.insights === false ? 'Declined' : 'Allowed'}</span>
            </Row>
          </>
        )}
        <Done message={saved} />
        <Alert id={errorId} message={error} />
      </Section>
    </>
  )
}
