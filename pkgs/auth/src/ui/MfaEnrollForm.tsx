import { useEffect, useMemo, useState } from 'react'
import encodeQR from '@paulmillr/qr'
import type { AuthClient } from '../client'
import type { MfaIdentity, MfaSetup } from '../types'
import { OTPForm } from './OTPForm'

export interface MfaEnrollFormProps {
  readonly client: AuthClient
  /**
   * Called once the user has verified a TOTP code AND the enrollment is
   * persisted. The caller continues the session (onboarding or the OIDC
   * code redirect).
   */
  readonly onComplete: () => void
}

/**
 * Forced TOTP enrollment, shown when IAM answers a login with `RequiredMfa`
 * (org policy requires MFA and the user has none). There is intentionally NO
 * skip / dismiss control — the only way past this screen is to enroll an
 * authenticator. The QR is rendered locally from the `otpauth://` URI, so the
 * TOTP secret never leaves the browser.
 *
 * Flow: `getAccount` (resolve identity from the session IAM set with
 * `RequiredMfa`) → `mfaInitiate` (secret + QR) → user scans → `mfaVerify`
 * (prove the code) → `mfaEnable` (persist) → `onComplete`.
 */
export function MfaEnrollForm({ client, onComplete }: MfaEnrollFormProps) {
  const [identity, setIdentity] = useState<MfaIdentity | null>(null)
  const [setup, setSetup] = useState<MfaSetup | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function begin() {
      try {
        const id = await client.getAccount()
        if (!id) throw new Error('Your session could not be resolved. Please sign in again.')
        const s = await client.mfaInitiate(id)
        if (cancelled) return
        setIdentity(id)
        setSetup(s)
      } catch (e) {
        if (!cancelled) setFatal(e instanceof Error ? e.message : String(e))
      }
    }
    void begin()
    return () => {
      cancelled = true
    }
  }, [client])

  const qrSvg = useMemo(() => (setup ? encodeQR(setup.url, 'svg') : ''), [setup])

  async function onCode(code: string) {
    if (!identity || !setup || busy) return
    setBusy(true)
    setError(null)
    try {
      const verified = await client.mfaVerify({ owner: identity.owner, name: identity.name, secret: setup.secret, passcode: code })
      if (!verified.ok) {
        setError(verified.error ?? 'That code did not match. Try the current code from your app.')
        return
      }
      const enabled = await client.mfaEnable({
        owner: identity.owner,
        name: identity.name,
        secret: setup.secret,
        recoveryCode: setup.recoveryCodes[0] ?? '',
      })
      if (!enabled.ok) {
        setError(enabled.error ?? 'Could not enable two-factor authentication.')
        return
      }
      onComplete()
    } finally {
      setBusy(false)
    }
  }

  if (fatal) {
    return (
      <div className="hanzo-id-mfa-enroll">
        <h2>Two-factor setup</h2>
        <p role="alert" className="hanzo-id-error">{fatal}</p>
      </div>
    )
  }

  if (!setup) {
    return (
      <div className="hanzo-id-mfa-enroll">
        <h2>Two-factor setup</h2>
        <p className="lede">Preparing your authenticator…</p>
      </div>
    )
  }

  const recoveryCode = setup.recoveryCodes[0]
  return (
    <div className="hanzo-id-mfa-enroll">
      <h2>Set up two-factor authentication</h2>
      <p className="lede">
        Your organization requires two-factor authentication. Scan this QR code with an
        authenticator app (Google Authenticator, 1Password, Authy), then enter the 6-digit code it
        shows.
      </p>
      <div
        className="hanzo-id-mfa-qr"
        role="img"
        aria-label="TOTP enrollment QR code"
        // Local SVG from @paulmillr/qr — the otpauth secret never leaves the browser.
        dangerouslySetInnerHTML={{ __html: qrSvg }}
      />
      <details className="hanzo-id-mfa-manual">
        <summary>Can't scan? Enter this key manually</summary>
        <code className="hanzo-id-mfa-secret">{setup.secret}</code>
      </details>
      {error ? <p role="alert" className="hanzo-id-error">{error}</p> : null}
      <OTPForm channel="totp" onSubmit={onCode} />
      {recoveryCode ? (
        <p className="hanzo-id-mfa-recovery">
          Save this recovery code somewhere safe — it lets you sign in if you lose your device:
          <br />
          <code>{recoveryCode}</code>
        </p>
      ) : null}
    </div>
  )
}
