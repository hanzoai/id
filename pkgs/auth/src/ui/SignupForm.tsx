import { useState, type FormEvent } from 'react'
import { trainingOf, type AuthClient } from '../client'

/**
 * The AI-training question, asked on screen before the account is created. Held
 * as one exported string — like `SMS_CONSENT_TEXT` — so the exact wording
 * is greppable and reviewable in one place. The answer rides `/v1/iam/signup` as
 * `training`; the box starts unticked, and either answer creates the account.
 */
export const TRAINING_CONSENT_TEXT =
  'Use my data to train our AI models. This is optional: your account works ' +
  'either way, and you can change it later.'

export interface SignupFormProps {
  readonly client: AuthClient
  readonly inviteCode?: string
  readonly onSuccess?: () => void
}

export function SignupForm(props: SignupFormProps) {
  const { client } = props
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // Unticked: the default answer is no.
  const [consent, setConsent] = useState(false)
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
        training: trainingOf(consent),
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
    <form onSubmit={onSubmit} className="hanzo-id-form" aria-busy={busy}>
      <label className="hanzo-id-field">
        <span>Email</span>
        <input className="hanzo-id-input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="hanzo-id-field">
        <span>Password</span>
        <input
          className="hanzo-id-input"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={12}
          required
        />
      </label>
      <label className="hanzo-id-consent">
        <input
          className="hanzo-id-check"
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          disabled={busy}
        />
        <span>{TRAINING_CONSENT_TEXT}</span>
      </label>
      {error ? <p role="alert" className="hanzo-id-error">{error}</p> : null}
      <button type="submit" className="hanzo-id-btn" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
    </form>
  )
}
