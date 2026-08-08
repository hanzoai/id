import { useId, useState, type FormEvent } from 'react'
import type { AuthClient } from '../client'
import { Alert } from './Alert'
import { PasswordField } from './PasswordField'
import { Submit } from './Submit'

export interface ForgotFormProps {
  readonly client: AuthClient
  /** Called once the code is on its way. */
  readonly onSent?: () => void
  /** Called once the new password is set — the person can now sign in with it. */
  readonly onReset?: () => void
}

/**
 * Recovery, both halves, on one screen.
 *
 * IAM sends a 6-DIGIT CODE with a ten-minute life and no link of any kind, so
 * "check your inbox for a reset link" described a mechanism that never existed.
 * Naming the code fixed the sentence; this page can now keep it, because the code
 * has somewhere to go: `PUT /v1/iam/password` redeems it into a new password.
 *
 * Staying on one screen is what makes that honest. The address is already in hand —
 * and IAM redeems a code against the address it was minted for — so asking for the
 * code and the new password right here means the person never has to carry either
 * one somewhere else.
 */
export function ForgotForm(props: ForgotFormProps) {
  const { client } = props
  const [identifier, setIdentifier] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The stage IS the state: whether a code is outstanding, and whether the new
  // password has landed. Nothing else decides what is on screen.
  const [sent, setSent] = useState(false)
  const [done, setDone] = useState(false)
  const errorId = useId()

  async function send(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      // The descriptor names the application the code is minted under (owner/name),
      // read rather than assembled from a guessed owner.
      //
      // It is NOT asked whether code sign-in is switched on. That mattered while the
      // only place a code could be spent was the sign-in page's code arm; a reset
      // spends one whatever the app offers, so refusing here would deny recovery to
      // every application that does not also want passwordless sign-in.
      const app = await client.getAppLogin()
      if (!app) {
        setError('cannot read the sign-in configuration for this application')
        return
      }
      const res = await client.sendCode({ dest: identifier, channel: 'email', application: app.id })
      if (!res.ok) setError(res.error ?? 'the code could not be sent')
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

  async function reset(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      // The SAME address the code went to. IAM redeems a code against the account it
      // was minted for, so this is not a second chance to name one.
      const res = await client.setPassword({
        identifier,
        organization: client.org.orgId,
        code,
        password,
      })
      if (!res.ok) setError(res.error ?? 'the password could not be set')
      else {
        setDone(true)
        props.onReset?.()
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    // The reset also cleared the account lockout, so the new password works now
    // rather than after the fifteen-minute window a run of wrong guesses opened.
    return (
      <p className="hanzo-id-info">
        Your new password is set. <a href="/login">Sign in with it.</a>
      </p>
    )
  }

  if (sent) {
    return (
      <form onSubmit={reset} className="hanzo-id-form" aria-busy={busy}>
        <p className="hanzo-id-info">We sent a 6-digit code to {identifier}.</p>
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
        <PasswordField label="New password" value={password} onChange={setPassword} autoComplete="new-password" minLength={8} />
        <Alert id={errorId} message={error} />
        <Submit busy={busy} ready={code.length === 6} label="Set new password" busyLabel="Setting…" />
      </form>
    )
  }

  return (
    <form onSubmit={send} className="hanzo-id-form" aria-busy={busy}>
      <label className="hanzo-id-field">
        <span>Email</span>
        <input
          className="hanzo-id-input"
          type="email"
          autoComplete="email"
          aria-invalid={error !== null || undefined}
          aria-describedby={errorId}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          required
        />
      </label>
      <Alert id={errorId} message={error} />
      <Submit busy={busy} label="Send code" busyLabel="Sending…" />
    </form>
  )
}
