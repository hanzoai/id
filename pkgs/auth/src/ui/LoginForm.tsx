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
      const res = await client.login({
        identifier,
        password,
        clientId: props.clientIdOverride ?? client.tenant.clientId,
        application: client.tenant.appName,
        // Org-agnostic by default: `loginOrg` is unset, so no `organization` is
        // posted and IAM resolves the user cross-org by credentials. A global
        // admin (identity in the `admin` org) lands in the global multi-org
        // session; a brand-only user lands in their own org. Pinning the brand
        // org here would truncate a global admin to one org (the live bug).
        organization: client.tenant.loginOrg,
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
