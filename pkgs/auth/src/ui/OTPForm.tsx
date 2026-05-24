import { useState, type FormEvent } from 'react'

export interface OTPFormProps {
  readonly onSubmit: (code: string) => void | Promise<void>
  readonly length?: number
  readonly channel?: 'totp' | 'sms' | 'email'
}

export function OTPForm(props: OTPFormProps) {
  const { length = 6, channel = 'totp' } = props
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (code.length !== length) return
    setBusy(true)
    try {
      await props.onSubmit(code)
    } finally {
      setBusy(false)
    }
  }

  const label = channel === 'sms' ? 'SMS code' : channel === 'email' ? 'Email code' : 'Authenticator code'

  return (
    <form onSubmit={onSubmit} className="id-portal-otp-form" aria-busy={busy}>
      <label>
        <span>{label}</span>
        <input
          type="text"
          inputMode="numeric"
          pattern={`\\d{${length}}`}
          maxLength={length}
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, length))}
          required
        />
      </label>
      <button type="submit" disabled={busy || code.length !== length}>{busy ? 'Verifying…' : 'Verify'}</button>
    </form>
  )
}
