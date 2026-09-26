import { useId, useState, type FormEvent } from 'react'
import type { AuthClient } from '../client'
import { Alert } from './Alert'
import { PasswordField } from './PasswordField'
import { Submit } from './Submit'

export interface SignupFormProps {
  readonly client: AuthClient
  /**
   * The downstream OIDC request the user arrived with, when an app sent them
   * here to register. Forwarded to the sign-in that follows account creation so
   * the flow ends where it started — back at the app, holding a code.
   */
  readonly redirectUri?: string
  readonly state?: string
  readonly clientIdOverride?: string
  readonly codeChallenge?: string
  readonly codeChallengeMethod?: 'S256' | 'plain'
  readonly nonce?: string
  /**
   * Where an account that was created but not signed in continues: the sign-in
   * page for the same application and request. Defaults to `/login` with this
   * page's query.
   */
  readonly signinHref?: string
  /**
   * Where a person whose address already has an account resets its password.
   * Defaults to `/forget` with this page's query.
   */
  readonly forgotHref?: string
  /**
   * The moments a host may want to count, handed out rather than measured here:
   * this package is the flow, and what watches it is the page's business.
   *
   * `onSubmitted` runs once per attempt that gets past the busy guard, so an
   * impatient second click is still one attempt. `onCompleted` runs when the
   * account exists — every branch below that one reaches has created it — and
   * BEFORE the browser leaves, which is the only place a caller can still act.
   *
   * `onCompleted` is handed the new account's IAM subject, so a caller that
   * counts this moment can say WHOSE it was. The subject and nothing else: it is
   * an opaque id, it is what every other surface knows this person by, and the
   * address that was typed into this form is not the caller's business.
   */
  readonly onSubmitted?: () => void
  readonly onCompleted?: (subject?: string) => void
}

/** IAM's refusals the form acts on (`internal/oidc/signup.go`). */
const TAKEN = 'email already exists'
const CODE_REQUIRED = 'the code sent to the email address is required'

/** `href` with `login_hint` set to the address, so the page it opens starts filled in. */
function hinted(href: string, address: string): string {
  const i = href.indexOf('?')
  const q = new URLSearchParams(i < 0 ? '' : href.slice(i + 1))
  q.set('login_hint', address)
  return `${i < 0 ? href : href.slice(0, i)}?${q}`
}

export function SignupForm(props: SignupFormProps) {
  const { client } = props
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  // The address a code went to. The stage IS this state: null asks for the
  // account, an address asks for the code that proves it.
  const [sentTo, setSentTo] = useState<string | null>(null)
  // The address IAM refused because an account already has it. Set, the form
  // gives way to the ways back into that account.
  const [taken, setTaken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const errorId = useId()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      // One attempt is the person asking for the account; the code that follows
      // belongs to the same attempt.
      if (sentTo === null) props.onSubmitted?.()
      // Register against the app the user CAME FROM, not this portal. IAM's
      // signup resolves the application by clientId and then gates the org
      // against that app's own org, so a downstream `client_id` must reach
      // it or the account is created under the portal's app instead.
      const clientId = props.clientIdOverride ?? client.org.clientId
      const app = await client.getAppLogin(clientId, props.redirectUri)
      const application = app?.application ?? client.org.appName
      const organization = app?.organization ?? client.org.orgId

      // The first submit carries no code. IAM checks the password policy and
      // whether the address is taken before it asks for one, so a taken address
      // or a refused password is answered here, before any code is sent.
      const session = await client.signup({
        email: sentTo ?? email,
        password,
        ...(sentTo === null ? {} : { code }),
        clientId,
        application,
        organization,
        redirectUri: props.redirectUri,
        state: props.state,
        codeChallenge: props.codeChallenge,
        codeChallengeMethod: props.codeChallengeMethod,
        nonce: props.nonce,
      })
      // The address is proven before the account exists, where IAM can deliver a
      // code at all: the person who receives it is then certainly the person
      // choosing this password, and IAM records the address proven. Where it
      // cannot, IAM asks for no code and the account is made unproven.
      if (sentTo === null && app && session.error === CODE_REQUIRED) {
        const sent = await client.sendCode({ dest: email, channel: 'email', application: app.id })
        if (!sent.ok) {
          setError(sent.error ?? 'the code could not be sent')
          return
        }
        setCode('')
        setSentTo(email)
        return
      }
      if (session.error === TAKEN) {
        setTaken(sentTo ?? email)
        return
      }
      if (session.error) {
        setError(session.error)
        return
      }
      // Past the refusal, the account is created — whether the session lands
      // here, waits on a second factor, or has to be picked up at sign-in.
      props.onCompleted?.(session.subject)
      if (session.redirectUrl) {
        window.location.href = session.redirectUrl
        return
      }
      // The account exists but the session did not complete here — an org that
      // forces MFA answers the login with an enrollment step. Hand the user to
      // the sign-in page, carrying the same OIDC request, rather than leaving
      // them on a form that has nothing left to do.
      if (session.mfaRequired) {
        window.location.href = props.signinHref ?? `/login${window.location.search}`
        return
      }
      setError('Your account was created, but sign-in did not complete. Please sign in.')
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  if (taken !== null) {
    return (
      <div className="hanzo-id-form">
        <p className="hanzo-id-info" role="status">
          {taken} already has an account.
        </p>
        <a className="hanzo-id-btn" href={hinted(props.signinHref ?? `/login${window.location.search}`, taken)}>
          Sign in
        </a>
        <a className="hanzo-id-btn ghost" href={hinted(props.forgotHref ?? `/forget${window.location.search}`, taken)}>
          Reset password
        </a>
        <button
          type="button"
          className="hanzo-id-linkbtn"
          onClick={() => {
            setTaken(null)
            setSentTo(null)
          }}
        >
          Use a different email
        </button>
      </div>
    )
  }

  if (sentTo !== null) {
    return (
      <form onSubmit={onSubmit} className="hanzo-id-form" aria-busy={busy}>
        <p className="hanzo-id-info">We sent a 6-digit code to {sentTo}.</p>
        <label className="hanzo-id-field">
          <span>Code</span>
          <input
            className="hanzo-id-input"
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoComplete="one-time-code"
            aria-invalid={error !== null || undefined}
            aria-describedby={errorId}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            required
          />
        </label>
        <Alert id={errorId} message={error} />
        <Submit busy={busy} ready={code.length === 6} label="Create account" busyLabel="Creating account…" />
        <button
          type="button"
          className="hanzo-id-linkbtn"
          onClick={() => {
            setSentTo(null)
            setError(null)
          }}
        >
          Change email or password
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={onSubmit} className="hanzo-id-form" aria-busy={busy}>
      <label className="hanzo-id-field">
        <span>Email</span>
        <input
          className="hanzo-id-input"
          type="email"
          autoComplete="email"
          aria-invalid={error !== null || undefined}
          aria-describedby={errorId}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>
      <PasswordField
        label="Password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        minLength={12}
        invalid={error !== null}
        describedBy={errorId}
      />
      <Alert id={errorId} message={error} />
      <Submit busy={busy} label="Create account" busyLabel="Creating account…" />
    </form>
  )
}
