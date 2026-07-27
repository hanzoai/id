import { useState, type FormEvent } from 'react'
import type { AuthClient } from '../client'

export interface ForgotFormProps {
  readonly client: AuthClient
  readonly onSent?: () => void
}

export function ForgotForm(props: ForgotFormProps) {
  const { client } = props
  const [identifier, setIdentifier] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await client.forgot({
        identifier,
        clientId: client.tenant.clientId,
        organization: client.tenant.orgId,
      })
      if (!res.ok) setError(res.error ?? 'send failed')
      else {
        setSent(true)
        props.onSent?.()
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return <p className="hanzo-id-info">Check your inbox for a reset link.</p>
  }

  return (
    <form onSubmit={onSubmit} className="hanzo-id-form" aria-busy={busy}>
      <label className="hanzo-id-field">
        <span>Email</span>
        <input className="hanzo-id-input" type="email" autoComplete="email" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
      </label>
      {error ? <p role="alert" className="hanzo-id-error">{error}</p> : null}
      <button type="submit" className="hanzo-id-btn" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
    </form>
  )
}
