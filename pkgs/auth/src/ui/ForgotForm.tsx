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
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      // The descriptor names the application the code is minted under (owner/name)
      // and says whether a code can be spent here at all — both from the one read.
      const app = await client.getAppLogin()
      if (!app) {
        setError('cannot read the sign-in configuration for this application')
        return
      }
      if (!app.enableCodeSignin) {
        // Refuse rather than mint. IAM sends a 6-digit code and nothing else, and
        // the ONE place a code can be spent is the sign-in page's code arm; with
        // that arm switched off the code would arrive with nowhere to go.
        setError('this application cannot sign you in with a code yet, so a code cannot get you back in')
        return
      }
      const res = await client.sendCode({ dest: identifier, channel: 'email', application: app.id })
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
    // Name what actually arrives. IAM mints a 6-digit code with a ten-minute life
    // and no link of any kind (verificationCodeLength, sendverificationcode.go), so
    // "check your inbox for a reset link" described a mechanism that has never
    // existed and left the person watching for a mail nobody was going to send.
    //
    // The code is spendable at exactly one place — the sign-in page's code arm,
    // keyed on the same identifier this page sent it to — which is why recovery
    // needs no page of its own: proving the address IS the way back in.
    return (
      <p className="hanzo-id-info">
        We sent a 6-digit code to {identifier}. <a href="/login">Sign in with the code</a> to get
        back in, then set a new password.
      </p>
    )
  }

  return (
    <form onSubmit={onSubmit} className="hanzo-id-form" aria-busy={busy}>
      <label className="hanzo-id-field">
        <span>Email</span>
        <input className="hanzo-id-input" type="email" autoComplete="email" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
      </label>
      {error ? <p role="alert" className="hanzo-id-error">{error}</p> : null}
      <button type="submit" className="hanzo-id-btn" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
    </form>
  )
}
