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
      // BOTH entry points resolve the same way — the downstream-app login
      // (clientIdOverride) and the brand portal's own bare sign-in. They used to
      // differ: the bare portal deliberately posted NO `organization` so IAM's
      // cross-org fallback landed a colliding identity (z@hanzo.ai exists in both
      // `admin` and `hanzo`) on admin/* and returned the full multi-org session.
      //
      // That is gone, on purpose, at the server. iam2 scopes every credential
      // lookup to one org and treats the collision it relied on as a defect —
      // "the F-2 bug where z@hanzo.ai collided across admin and hanzo" — because
      // cross-org resolution coupled lockout counters across rows and gave a
      // brute-force oracle on the superadmin. So it now REFUSES an org-less login
      // with "organization, username and password are required". It answers HTTP
      // **200**, which the form then renders as if the user's own password were
      // wrong, and which every status-code monitor reads as green — the apex form
      // was dead on hanzo.id, lux.id, iam.hanzo.ai and pars.id simultaneously.
      //
      // Posting the app's own org is the established answer (it is what the
      // override path already does, and what reaches admin/* for admin-org apps).
      // A global admin is no longer resolved by omission; they reach the admin
      // identity by signing into an admin-org app, which is the explicit path.
      const app = await client.getAppLogin(props.clientIdOverride ?? client.org.clientId)
      const application = app?.application ?? client.org.appName
      const organization = app?.organization ?? client.org.loginOrg
      const res = await client.login({
        identifier,
        password,
        clientId: props.clientIdOverride ?? client.org.clientId,
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
    <form onSubmit={onSubmit} className="hanzo-id-form" aria-busy={busy}>
      <label className="hanzo-id-field">
        <span>Email or username</span>
        <input
          className="hanzo-id-input"
          type="text"
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          required
        />
      </label>
      <label className="hanzo-id-field">
        <span>Password</span>
        <input
          className="hanzo-id-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {error ? <p role="alert" className="hanzo-id-error">{error}</p> : null}
      <button type="submit" className="hanzo-id-btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  )
}
