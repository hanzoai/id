import { useId, useState, type FormEvent } from 'react'
import type { AuthClient } from '../client'
import { Alert } from './Alert'
import { PasswordField } from './PasswordField'
import { Submit } from './Submit'

export interface SignupFormProps {
  readonly client: AuthClient
  readonly inviteCode?: string
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
}

export function SignupForm(props: SignupFormProps) {
  const { client } = props
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const errorId = useId()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      // Register against the app the user CAME FROM, not this portal. IAM's
      // signup resolves the application by clientId and then gates the org
      // against that app's own org, so a downstream `client_id` must reach
      // it or the account is created under the portal's app instead.
      const clientId = props.clientIdOverride ?? client.org.clientId
      const app = await client.getAppLogin(clientId, props.redirectUri)
      const application = app?.application ?? client.org.appName
      const organization = app?.organization ?? client.org.orgId

      const session = await client.signup({
        email,
        password,
        clientId,
        application,
        organization,
        inviteCode: props.inviteCode,
        redirectUri: props.redirectUri,
        state: props.state,
        codeChallenge: props.codeChallenge,
        codeChallengeMethod: props.codeChallengeMethod,
        nonce: props.nonce,
      })
      if (session.error) {
        setError(session.error)
        return
      }
      if (session.redirectUrl) {
        window.location.href = session.redirectUrl
        return
      }
      // The account exists but the session did not complete here — an org that
      // forces MFA answers the login with an enrollment step. Hand the user to
      // the sign-in page, carrying the same OIDC request, rather than leaving
      // them on a form that has nothing left to do.
      if (session.mfaRequired) {
        window.location.href = `/login${window.location.search}`
        return
      }
      setError('Your account was created, but sign-in did not complete. Please sign in.')
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
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
