import { useState, type FormEvent } from 'react'
import { SmsConsentNotice } from './SmsConsent'
import { Submit } from './Submit'

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
    if (busy || code.length !== length) return
    setBusy(true)
    try {
      await props.onSubmit(code)
    } finally {
      setBusy(false)
    }
  }

  const label = channel === 'sms' ? 'SMS code' : channel === 'email' ? 'Email code' : 'Authenticator code'

  return (
    <form onSubmit={onSubmit} className="hanzo-id-form" aria-busy={busy}>
      <label className="hanzo-id-field">
        <span>{label}</span>
        <input
          className="hanzo-id-input"
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
      {channel === 'sms' ? <SmsConsentNotice /> : null}
      <Submit busy={busy} label="Verify" busyLabel="Verifying…" ready={code.length === length} />
    </form>
  )
}
