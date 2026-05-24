import { useState, type FormEvent } from 'react'
import type { AuthClient } from '../client'

export interface SignupFormProps {
  readonly client: AuthClient
  readonly inviteCode?: string
  readonly onSuccess?: () => void
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
      const res = await client.signup({
        email,
        password,
        clientId: client.tenant.clientId,
        application: client.tenant.appName,
        organization: client.tenant.orgId,
        inviteCode: props.inviteCode,
      })
      if (res.error) setError(res.error)
      else if (res.redirectUrl) window.location.href = res.redirectUrl
      else props.onSuccess?.()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="hanzo-id-signup-form" aria-busy={busy}>
      <label>
        <span>Email</span>
        <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        <span>Password</span>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={12}
          required
        />
      </label>
      {error ? <p role="alert" className="hanzo-id-error">{error}</p> : null}
      <button type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
    </form>
  )
}
