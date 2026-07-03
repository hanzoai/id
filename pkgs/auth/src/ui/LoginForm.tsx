import { useState, type FormEvent } from 'react'
import type { AuthClient } from '../client'
import type { LoginResponse } from '../types'

export interface LoginFormProps {
  readonly client: AuthClient
  readonly redirectUri?: string
  readonly state?: string
  readonly clientIdOverride?: string
  readonly codeChallenge?: string
  readonly codeChallengeMethod?: 'S256' | 'plain'
  readonly nonce?: string
  readonly onSuccess?: (res: LoginResponse) => void
  readonly onMfaRequired?: (res: LoginResponse) => void
  /**
   * Called after a successful sign-in INSTEAD of the form's default post-login
   * navigation. When provided, the form does not redirect (neither to a
   * downstream app nor to `/onboarding`) — the caller owns what happens next.
   * Used by the device-approval page to stay on-page and show the confirm step.
   */
  readonly onAuthenticated?: (res: LoginResponse) => void
}

export function LoginForm(props: LoginFormProps) {
  const { client } = props
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // Authenticate against the ORG OF THE APP being logged into, not the
      // portal's own brand. When a downstream app initiates the login it passes
      // its own `client_id` (props.clientIdOverride); that app may live in a
      // different org than this brand portal — e.g. the admin-guard
      // (client_id=hanzo-admin-guard) is in the `admin` org, so its operators
      // must resolve to the admin/* identity (owner=admin), NOT this brand's
      // hanzo/* row. get-app-login is the canonical clientId -> {application,
      // organization} map; resolve through it and post BOTH so IAM scopes the
      // credential check to the app's org.
      //
      // With no override this is the brand portal's OWN bare sign-in: keep it
      // org-agnostic (`loginOrg` unset -> no `organization` posted) so a global
      // admin resolves cross-org into the full multi-org session instead of
      // being truncated to one brand org.
      let application = client.tenant.appName
      let organization = client.tenant.loginOrg
      if (props.clientIdOverride) {
        const app = await client.getAppLogin(props.clientIdOverride)
        if (app) {
          application = app.application
          organization = app.organization
        }
      }
      const res = await client.login({
        identifier,
        password,
        clientId: props.clientIdOverride ?? client.tenant.clientId,
        application,
        organization,
        redirectUri: props.redirectUri,
        state: props.state,
        codeChallenge: props.codeChallenge,
        codeChallengeMethod: props.codeChallengeMethod,
        nonce: props.nonce,
      })
      if (res.error) {
        setError(res.error)
      } else if (res.mfaRequired) {
        props.onMfaRequired?.(res)
      } else if (props.onAuthenticated) {
        // Caller owns the next step (e.g. device approval) — suppress the
        // default navigation so we stay on-page.
        props.onAuthenticated(res)
      } else if (res.redirectUrl) {
        window.location.href = res.redirectUrl
      } else {
        props.onSuccess?.(res)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="hanzo-id-login-form" aria-busy={busy}>
      <label>
        <span>Email or username</span>
        <input
          type="text"
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          required
        />
      </label>
      <label>
        <span>Password</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {error ? <p role="alert" className="hanzo-id-error">{error}</p> : null}
      <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  )
}
