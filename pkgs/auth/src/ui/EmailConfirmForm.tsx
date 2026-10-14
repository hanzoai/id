import { useId, useState, type FormEvent } from 'react'
import type { AuthClient } from '../client'
import type { EmailChallenge, LoginResponse } from '../types'
import { Alert } from './Alert'
import { Submit } from './Submit'

export interface EmailConfirmFormProps {
  readonly client: AuthClient
  /** The hold IAM answered the sign-in with: where the code went, and the sign-in's own parameters. */
  readonly challenge: EmailChallenge
  /**
   * Called with IAM's answer once the address is proven — the answer the sign-in
   * itself would have given: a redirect with an auth code, a second factor, a bare
   * session. The page routes it exactly as it routes any other sign-in answer.
   */
  readonly onAnswer: (res: LoginResponse) => void | Promise<void>
  /**
   * Called with IAM's sentence when the held sign-in has expired. Nothing on this
   * step can revive it, so the page returns to its sign-in form.
   */
  readonly onExpired: (message: string) => void
}

/** IAM's refusal for a held sign-in that has lapsed; every other refusal leaves the step usable. */
const EXPIRED = 'the sign-in has expired; sign in again'

/**
 * "Confirm your email" — the step a sign-in stops on when IAM answers it with
 * `RequiredEmail`.
 *
 * IAM holds every sign-in of an account whose address was never proven and sends
 * a 6-digit code to the address on file. This step takes that code, asks for a
 * new one, or takes a different address. Every post carries the held sign-in's
 * own parameters (`challenge.params`), so once the address is proven IAM answers
 * what the sign-in would have answered and the page carries on from there. An
 * account with no address on file starts on the address field.
 *
 * A wrong code, or an address IAM will not take, is IAM's own sentence shown on
 * the step, which stays usable: IAM re-arms the challenge for the next try.
 */
export function EmailConfirmForm(props: EmailConfirmFormProps) {
  const { client } = props
  // The hold being answered. A send replaces it: the address it names is where
  // the latest code went.
  const [challenge, setChallenge] = useState(props.challenge)
  // Asking for an address rather than a code — from the start when none is on
  // file, and once the person chooses a different one.
  const [asking, setAsking] = useState(props.challenge.email === '')
  const [address, setAddress] = useState('')
  const [code, setCode] = useState('')
  // A second code went to the same address, and the sentence says so.
  const [resent, setResent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const errorId = useId()

  // Every post on this step answers one of four ways: the hold has lapsed, IAM
  // refused this try, IAM holds the sign-in again naming where a code went, or
  // the address is proven and the sign-in's own answer goes to the page.
  async function post(step: () => Promise<LoginResponse>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await step()
      if (res.error === EXPIRED) {
        props.onExpired(res.error)
      } else if (res.error) {
        setError(res.error)
      } else if (res.emailRequired) {
        const next = res.emailRequired
        setResent(next.email !== '' && next.email === challenge.email)
        setChallenge(next)
        setAsking(next.email === '')
        setCode('')
      } else {
        await props.onAnswer(res)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  function onConfirm(e: FormEvent) {
    e.preventDefault()
    // The submit reports an incomplete code instead of removing itself (see
    // Submit), so a press still reaches here and is refused where it is known.
    if (code.length !== 6) return
    void post(() => client.emailConfirm({ ...challenge.params, passcode: code }))
  }

  function onSend(e: FormEvent) {
    e.preventDefault()
    const email = address.trim()
    if (!email) return
    void post(() => client.emailSend({ ...challenge.params, email }))
  }

  const invalid = error !== null || undefined

  if (asking) {
    return (
      <>
        <h1>Confirm your email</h1>
        <p className="lede">
          A confirmed email address is required to sign in. Enter yours and we&apos;ll send it a 6-digit code.
        </p>
        <form onSubmit={onSend} className="id-form" aria-busy={busy}>
          <label className="id-field">
            <span>Email</span>
            <input
              className="id-input"
              type="email"
              autoComplete="email"
              aria-invalid={invalid}
              aria-describedby={errorId}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
            />
          </label>
          <Alert id={errorId} message={error} />
          <Submit busy={busy} ready={address.trim() !== ''} label="Send code" busyLabel="Sending…" />
          {/* Back to the code already sent, so choosing a different address by
              mistake strands nobody. */}
          {challenge.email ? (
            <button
              type="button"
              className="id-linkbtn"
              onClick={() => {
                setAsking(false)
                setError(null)
              }}
            >
              Enter the code sent to {challenge.email}
            </button>
          ) : null}
        </form>
      </>
    )
  }

  return (
    <>
      <h1>Confirm your email</h1>
      <p className="lede" aria-live="polite">
        {resent ? `We sent a new code to ${challenge.email}.` : `We sent a 6-digit code to ${challenge.email}.`}
      </p>
      <form onSubmit={onConfirm} className="id-form" aria-busy={busy}>
        <label className="id-field">
          <span>Code</span>
          <input
            className="id-input"
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoComplete="one-time-code"
            aria-invalid={invalid}
            aria-describedby={errorId}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            required
          />
        </label>
        <Alert id={errorId} message={error} />
        <Submit busy={busy} ready={code.length === 6} label="Confirm" busyLabel="Confirming…" />
        <button
          type="button"
          className="id-linkbtn"
          onClick={() => void post(() => client.emailSend({ ...challenge.params, email: challenge.email }))}
        >
          Send a new code
        </button>
        <button
          type="button"
          className="id-linkbtn"
          onClick={() => {
            setAsking(true)
            setAddress('')
            setError(null)
          }}
        >
          Use a different email
        </button>
      </form>
    </>
  )
}
