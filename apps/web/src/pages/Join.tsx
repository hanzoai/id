import { useEffect, useId, useState, type FormEvent } from 'react'
import type { Brand, Org } from '@hanzo/id-shared'
import { Alert, SignupForm, Submit, type Account, type AuthClient } from '@hanzo/id-auth'
import { BrandFooter } from '../components/BrandFooter'
import { teamFor } from '../marketing'
import { clientIdFrom } from '../route'

/**
 * `/join?client_id=<app>&invite=<code>&org=<owner>` — the page an invite link opens.
 *
 * The link names the application the person was invited into, and both ways in
 * go THROUGH it, as /signup and /login do: an account is registered against that
 * app and a sign-in authenticates in it. With no `client_id` the host's own app
 * answers.
 *
 * An invitation is a row the org's admin wrote in IAM; this page only carries its
 * code to the one door that fits the person holding the link:
 *
 *  - signed out → create an account on the invitation (POST /v1/iam/signup with
 *                 `organization` and `invitationCode`), or sign in and come back
 *                 here (`/login?return=`).
 *  - signed in  → join as that account (POST /v1/iam/invitations/accept). An
 *                 invitation pinned to an address also wants a code: accept sends
 *                 one to the account's own address itself and says so, and the
 *                 page sends it back as `emailCode`.
 *
 * The org is named from the link, never looked up: a read that answered "this
 * code belongs to Acme" to anyone who asked would turn every guessed code into a
 * directory entry. IAM decides at the door, and a refusal is printed as it came.
 */
type Seen =
  | { s: 'loading' }
  | { s: 'anon' }
  | { s: 'unreadable'; why: string }
  | { s: 'authed'; account: Account }

export function Join({ client, brand, org }: { client: AuthClient; brand: Brand; org: Org }) {
  const sp = new URLSearchParams(window.location.search)
  const owner = sp.get('org') ?? ''
  const code = sp.get('invite') ?? ''
  const clientId = clientIdFrom(window.location.search, window.location.pathname)
  const [seen, setSeen] = useState<Seen>({ s: 'loading' })
  const [joined, setJoined] = useState<string | null>(null)
  // IAM's sentence about the code it sent, once it asked for one. The stage IS
  // this state: null offers Join, a sentence asks for the code it names.
  const [asked, setAsked] = useState<string | null>(null)
  const [emailCode, setEmailCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const errorId = useId()

  useEffect(() => {
    if (!owner || !code) return
    let alive = true
    client
      .getAccount()
      .then((account) => {
        if (alive) setSeen(account ? { s: 'authed', account } : { s: 'anon' })
      })
      .catch((e: unknown) => {
        if (alive) setSeen({ s: 'unreadable', why: e instanceof Error ? e.message : String(e) })
      })
    return () => {
      alive = false
    }
  }, [client, owner, code])

  // This page again, and the sign-in that comes back to it. Rebuilt from the
  // link's three fields rather than copied, so nothing else a link carried rides
  // along; the application travels to the sign-in too.
  const app: Record<string, string> = clientId ? { client_id: clientId } : {}
  const here = `/join?${new URLSearchParams({ ...app, invite: code, org: owner })}`
  const signin = `/login?${new URLSearchParams({ ...app, return: here })}`
  // Onward, to where this brand manages an organization; its own portal otherwise.
  const onward = teamFor(org.orgId) ?? '/'

  // One call for every step. Without `withCode` it asks to join, and for a pinned
  // invitation that is also how a code is sent: IAM sends one to the account's
  // own address and answers email_code_sent, or email_code_required when one went
  // out moments ago. Either way its sentence names the address and becomes the
  // code step's line. Every other refusal — a different address, a wrong code,
  // too many attempts, no mail from here — is IAM's sentence, shown as written.
  async function join(withCode: boolean) {
    if (busy || seen.s !== 'authed') return
    setBusy(true)
    setError(null)
    try {
      const res = await client.acceptInvitation({ owner, code, ...(withCode ? { emailCode } : {}) })
      if (res.ok) {
        setJoined(res.org ?? owner)
        return
      }
      if (res.reason === 'email_code_sent' || res.reason === 'email_code_required') {
        setAsked(res.error ?? null)
        setEmailCode('')
        return
      }
      setError(res.error ?? 'The invitation could not be accepted.')
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  function accept(e: FormEvent) {
    e.preventDefault()
    void join(asked !== null)
  }

  const frame = (body: React.ReactNode) => (
    <div className="id-page id-join">
      <main>{body}</main>
      <BrandFooter brand={brand} org={client.org} />
    </div>
  )

  if (!owner || !code) {
    return frame(
      <>
        <h1>This invite link is incomplete</h1>
        <p className="id-info">It is missing the organization or the invitation code. Ask the person who invited you to send the link again.</p>
        <p className="id-footer-links">
          <a href="/login">Go to sign in</a>
        </p>
      </>,
    )
  }

  if (seen.s === 'loading') {
    return (
      <div className="id-page" style={{ minHeight: '40vh' }}>
        <div className="id-spinner" />
      </div>
    )
  }

  if (seen.s === 'unreadable') {
    return frame(
      <>
        <h1>We could not check whether you are signed in</h1>
        <p role="alert" className="id-error">{seen.why}</p>
        <p className="id-footer-links">
          <a href={signin}>Sign in to join {owner}</a>
        </p>
      </>,
    )
  }

  if (seen.s === 'authed') {
    const who = seen.account.displayName || seen.account.name
    // An account made on this invitation is already in the org — it was created
    // there — so it is told so. Anyone else is offered Join: IAM's accept is
    // idempotent, so a person who is already a member spends nothing by pressing it.
    if (joined || seen.account.owner === owner) {
      const into = joined ?? owner
      return frame(
        <>
          <h1>{joined ? `You joined ${into}` : `You are in ${into}`}</h1>
          <p className="id-info">
            {who}
            {seen.account.email ? ` · ${seen.account.email}` : ''} is a member of {into}.
          </p>
          <a className="id-btn" href={onward}>Continue</a>
        </>,
      )
    }
    return frame(
      <>
        <h1>Join {owner}</h1>
        {asked !== null ? (
          <form onSubmit={accept} className="id-form" aria-busy={busy}>
            <p className="id-info">{asked}</p>
            <label className="id-field">
              <span>Code</span>
              <input
                className="id-input"
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                autoComplete="one-time-code"
                aria-invalid={error !== null || undefined}
                aria-describedby={errorId}
                value={emailCode}
                onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
              />
            </label>
            <Alert id={errorId} message={error} />
            <Submit busy={busy} ready={emailCode.length === 6} label={`Join ${owner}`} busyLabel="Joining…" />
            <button type="button" className="id-linkbtn" onClick={() => void join(false)}>
              Send a new code
            </button>
          </form>
        ) : (
          <form onSubmit={accept} className="id-form" aria-busy={busy}>
            <p className="id-info">
              Signed in as {who}
              {seen.account.email ? ` · ${seen.account.email}` : ''}.
            </p>
            <Alert id={errorId} message={error} />
            <Submit busy={busy} label={`Join ${owner}`} busyLabel="Joining…" />
          </form>
        )}
        <p className="id-footer-links">
          Not you? <a href={signin}>Sign in with another account</a>
        </p>
      </>,
    )
  }

  return frame(
    <>
      <h1>Join {owner}</h1>
      <p className="id-info">
        You were invited to join {owner} on {brand.name}. Create an account to accept, or sign in if you already have one.
      </p>
      <SignupForm
        client={client}
        clientIdOverride={clientId}
        invitation={{ org: owner, code }}
        landing={here}
        signinHref={signin}
        forgotHref={`/forget?${new URLSearchParams({ ...app, return: here })}`}
      />
      <p className="id-footer-links">
        Already have an account? <a href={signin}>Sign in</a>
      </p>
    </>,
  )
}
