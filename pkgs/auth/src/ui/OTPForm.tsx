import { useState, type FormEvent } from 'react'
import type { Brand, Org } from '@hanzo/id-shared'
import { SmsConsentNotice } from './SmsConsent'
import { Submit } from './Submit'

/**
 * An SMS code carries the consent notice, and the notice names the host's brand,
 * so the SMS channel requires the brand and org it is shown for.
 */
export type OTPFormProps = {
  readonly onSubmit: (code: string) => void | Promise<void>
  readonly length?: number
} & (
  | { readonly channel: 'sms'; readonly brand: Brand; readonly org: Org }
  | { readonly channel?: 'totp' | 'email'; readonly brand?: Brand; readonly org?: Org }
)

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
    <form onSubmit={onSubmit} className="id-form" aria-busy={busy}>
      <label className="id-field">
        <span>{label}</span>
        <input
          className="id-input"
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
      {props.channel === 'sms' ? <SmsConsentNotice brand={props.brand} org={props.org} /> : null}
      <Submit busy={busy} label="Verify" busyLabel="Verifying…" ready={code.length === length} />
    </form>
  )
}
