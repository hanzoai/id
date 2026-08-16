import { useCallback, useEffect, useId, useState } from 'react'
import type { Account, AccountClient, AuthClient, AuthMethods, LinkedAccount, Passkey } from '@hanzo/id-auth'
import { Alert, MfaEnrollForm, PasswordField, Submit } from '@hanzo/id-auth'
import { Busy, Done, Empty, Row, Section, Tag } from './ui'

/**
 * Everything that decides who gets in.
 *
 * Nothing here is a new authentication mechanism — each block drives a door IAM
 * already owns, and the enrollment flow is the SAME `MfaEnrollForm` the login
 * path shows when an org demands a factor. A second copy of that screen is a
 * second place for the recovery codes to be got wrong.
 */
export function Security({
  account,
  client,
  auth,
  signOutHref,
}: {
  account: Account
  client: AccountClient
  auth: AuthClient
  signOutHref: string
}) {
  return (
    <>
      <Password auth={auth} />
      <TwoFactor account={account} auth={auth} />
      <Passkeys client={client} />
      <Connected account={account} client={client} />
      <Section title="Sessions" describe="Ending your session here signs you out of this browser.">
        <p className="hanzo-id-note">
          A list of your other signed-in devices is not available yet — IAM records one row per
          application rather than per device, and carries no address or last-seen time to show. Until
          it does, this page will not invent one. Changing your password or your second factor already
          signs the other browsers out.
        </p>
        <a className="hanzo-id-btn ghost" href={signOutHref}>
          Sign out
        </a>
      </Section>
    </>
  )
}

/** `PUT /v1/iam/password` with the old one as the proof. IAM hashes with argon2id. */
function Password({ auth }: { auth: AuthClient }) {
  const [oldPassword, setOld] = useState('')
  const [password, setNew] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const errorId = useId()

  const mismatch = again.length > 0 && password !== again

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    if (password !== again) {
      setError('The two new passwords do not match.')
      return
    }
    setBusy(true)
    setError(null)
    setSaved(null)
    const r = await auth.setPassword({ oldPassword, password })
    setBusy(false)
    if (!r.ok) {
      setError(r.error ?? 'That did not work.')
      return
    }
    setOld('')
    setNew('')
    setAgain('')
    setSaved('Password changed.')
  }

  return (
    <Section title="Password" describe="Changing it signs out your other browsers.">
      <form className="hanzo-id-form" onSubmit={submit}>
        <PasswordField
          label="Current password"
          value={oldPassword}
          onChange={setOld}
          autoComplete="current-password"
          invalid={Boolean(error)}
          describedBy={errorId}
        />
        <PasswordField
          label="New password"
          value={password}
          onChange={setNew}
          autoComplete="new-password"
        />
        <PasswordField
          label="New password again"
          value={again}
          onChange={setAgain}
          autoComplete="new-password"
          invalid={mismatch}
          describedBy={errorId}
        />
        <Alert id={errorId} message={error} />
        <Done message={saved} />
        <Submit
          busy={busy}
          ready={oldPassword.length > 0 && password.length > 0 && !mismatch}
          label="Change password"
          busyLabel="Changing…"
        />
      </form>
    </Section>
  )
}

/**
 * Enrolling reuses the login path's screen verbatim. Turning it off is the verb
 * that had no caller: IAM revokes the account's other sessions on the way
 * through, which is why the copy says so.
 */
function TwoFactor({ account, auth }: { account: Account; auth: AuthClient }) {
  const [enrolling, setEnrolling] = useState(false)
  const [preferred, setPreferred] = useState(account.preferredMfaType)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const errorId = useId()

  async function disable() {
    if (busy) return
    setBusy(true)
    setError(null)
    setSaved(null)
    try {
      await auth.mfaDisable()
      setPreferred('')
      setSaved('Two-factor authentication is off.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (enrolling) {
    return (
      <Section title="Two-factor authentication" describe="Scan the code, then enter what the app shows.">
        <MfaEnrollForm
          client={auth}
          onComplete={() => {
            setEnrolling(false)
            setPreferred('app')
            setSaved('Two-factor authentication is on.')
          }}
        />
      </Section>
    )
  }

  return (
    <Section
      title="Two-factor authentication"
      describe="A code from your authenticator, asked for after your password."
      actions={
        preferred ? (
          <button type="button" className="hanzo-id-btn ghost" aria-disabled={busy} onClick={() => void disable()}>
            {busy ? 'Turning off…' : 'Turn off'}
          </button>
        ) : (
          <button type="button" className="hanzo-id-btn" onClick={() => setEnrolling(true)}>
            Turn on
          </button>
        )
      }
    >
      <Row label="Status">
        {preferred ? <Tag>On — {preferred === 'app' ? 'authenticator app' : preferred}</Tag> : <Tag>Off</Tag>}
      </Row>
      <Done message={saved} />
      <Alert id={errorId} message={error} />
    </Section>
  )
}

/** WebAuthn, through IAM's own ceremonies. The browser holds the private key. */
function Passkeys({ client }: { client: AccountClient }) {
  const [keys, setKeys] = useState<Passkey[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const errorId = useId()

  const load = useCallback(() => {
    client
      .passkeys()
      .then((k) => {
        setKeys(k)
        setError(null)
      })
      // A list that could not be read is NOT an empty list. Leaving `keys` null
      // keeps "No passkeys yet." off the screen, so the only thing shown is the
      // reason — a person who owns three passkeys must never be told they own
      // none because a request failed.
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [client])

  useEffect(load, [load])

  async function add() {
    if (busy) return
    setBusy(true)
    setError(null)
    setSaved(null)
    try {
      await client.addPasskey()
      setSaved('Passkey added.')
      load()
    } catch (e) {
      // A person dismissing the browser's own prompt is not a failure to report
      // as one — it is the answer "not now".
      const msg = e instanceof Error ? e.message : String(e)
      if (!/NotAllowedError|AbortError|aborted|timed out/i.test(msg)) setError(msg)
    } finally {
      setBusy(false)
    }
  }

  async function remove(name: string) {
    setError(null)
    setSaved(null)
    try {
      await client.removePasskey(name)
      setSaved('Passkey removed.')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Section
      title="Passkeys"
      describe="Sign in with your device instead of a password."
      actions={
        <button type="button" className="hanzo-id-btn ghost" aria-disabled={busy} onClick={() => void add()}>
          {busy ? 'Waiting for your device…' : 'Add passkey'}
        </button>
      }
    >
      {keys === null ? (
        error ? null : <Busy />
      ) : keys.length === 0 ? (
        <Empty>No passkeys yet.</Empty>
      ) : (
        keys.map((k) => (
          <Row
            key={k.name}
            label={k.attachment === 'platform' ? 'This device' : 'Security key'}
            hint={k.createdTime ? `Added ${new Date(k.createdTime).toLocaleDateString()}` : undefined}
            control={
              <button type="button" className="hanzo-id-linkbtn" onClick={() => void remove(k.name)}>
                Remove
              </button>
            }
          >
            {k.transport.length ? <Tag>{k.transport.join(', ')}</Tag> : null}
          </Row>
        ))
      )}
      <Done message={saved} />
      <Alert id={errorId} message={error} />
    </Section>
  )
}

/** Which other identities open this account, and the door to attach another. */
function Connected({ account, client }: { account: Account; client: AccountClient }) {
  const [linked, setLinked] = useState<LinkedAccount[] | null>(null)
  const [methods, setMethods] = useState<AuthMethods | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const errorId = useId()

  const load = useCallback(() => {
    client
      .linked()
      .then((l) => {
        setLinked(l)
        setError(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    client.methods().then(setMethods).catch(() => setMethods(null))
  }, [client])

  useEffect(load, [load])

  async function attach(type: string) {
    setError(null)
    setSaved(null)
    try {
      // Attaching runs the full federation hop, so the browser leaves this page
      // and comes back to it.
      window.location.href = await client.link(type, window.location.href)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function detach(provider: string) {
    setError(null)
    setSaved(null)
    try {
      await client.unlink(provider)
      setSaved('Disconnected.')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // The two sides name the same provider differently: a link is the CONNECTOR
  // COLUMN (`google`), while the catalogue answers with the provider record and
  // its type (`provider-google`, `Google`). Comparing them raw offered "Connect
  // Google" directly under the Google account that was already connected —
  // measured on a live account. One spelling, both sides, and a provider is
  // considered attached if EITHER of its names matches.
  const key = (s: string) => s.replace(/^provider-/, '').toLowerCase()
  const attached = new Set((linked ?? []).map((l) => key(l.provider)))
  const offered = (methods?.oauth ?? []).filter((o) => !attached.has(key(o.type)) && !attached.has(key(o.name)))

  return (
    <Section title="Connected accounts" describe={`Other identities that sign you in to ${account.owner}.`}>
      {linked === null ? (
        error ? null : <Busy />
      ) : linked.length === 0 ? (
        <Empty>Nothing connected.</Empty>
      ) : (
        linked.map((l) => (
          <Row
            key={l.provider}
            label={label(l.provider)}
            hint={l.subject}
            control={
              <button type="button" className="hanzo-id-linkbtn" onClick={() => void detach(l.provider)}>
                Disconnect
              </button>
            }
          />
        ))
      )}
      {offered.map((o) => (
        <Row
          key={o.type}
          label={label(o.name || o.type)}
          control={
            <button type="button" className="hanzo-id-linkbtn" onClick={() => void attach(o.type)}>
              Connect
            </button>
          }
        />
      ))}
      <Done message={saved} />
      <Alert id={errorId} message={error} />
    </Section>
  )
}

/**
 * IAM names a connector by its column; a person knows it by its product. Capital
 * letters inside a name are not decoration — "Github" is not how GitHub is
 * written, and a settings page that misspells the thing you are about to trust
 * it with has spent something it did not need to.
 */
const WRITTEN: Record<string, string> = { github: 'GitHub', gitlab: 'GitLab', linkedin: 'LinkedIn', web3: 'Wallet' }

function label(provider: string): string {
  const p = provider.replace(/^provider-/, '').toLowerCase()
  return WRITTEN[p] ?? p.charAt(0).toUpperCase() + p.slice(1)
}
