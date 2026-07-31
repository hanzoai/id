import { useState, type FormEvent } from 'react'
import type { AuthClient } from '../client'

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

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // Register against the app the user CAME FROM, not this portal. IAM's
      // signup resolves the application by clientId and then gates the org
      // against that app's own tenant, so a downstream `client_id` must reach
      // it or the account is created under the portal's app instead.
      const clientId = props.clientIdOverride ?? client.tenant.clientId
      const app = await client.getAppLogin(clientId, props.redirectUri)
      const application = app?.application ?? client.tenant.appName
      const organization = app?.organization ?? client.tenant.orgId

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
        <input className="hanzo-id-input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="hanzo-id-field">
        <span>Password</span>
        <input
          className="hanzo-id-input"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={12}
          required
        />
      </label>
      {error ? <p role="alert" className="hanzo-id-error">{error}</p> : null}
      <button type="submit" className="hanzo-id-btn" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
    </form>
  )
}
