import { useEffect, useId, useState, type FormEvent } from 'react'
import type { AuthClient } from '../client'
import type { AppLogin, LoginResponse } from '../types'
import { Alert } from './Alert'
import { lazy, Suspense } from 'react'
import { PasswordField } from './PasswordField'
import { Submit } from './Submit'

export interface LoginFormProps {
  readonly client: AuthClient
  readonly redirectUri?: string
  readonly state?: string
  readonly clientIdOverride?: string
  readonly codeChallenge?: string
  readonly codeChallengeMethod?: 'S256' | 'plain'
  readonly nonce?: string
  readonly onSuccess?: (res: LoginResponse) => void
  readonly onMfaRequired?: (res: LoginResponse) => void
  /**
   * Called after a successful sign-in INSTEAD of the form's default post-login
   * navigation. When provided, the form does not redirect (neither to a
   * downstream app nor to `/onboarding`) — the caller owns what happens next.
   * Used by the device-approval page to stay on-page and show the confirm step.
   */
  readonly onAuthenticated?: (res: LoginResponse) => void
  /**
   * Which identifier this field asks for, and how to change it.
   *
   * CONTROLLED, and owned by the page rather than by this form, because the
   * control that switches it is no longer inside the form — it is an entry in
   * the sign-in strip ("Continue with Phone"), which is a sibling. Two
   * components acting on one value means the value belongs to their parent; the
   * alternative is this form holding state a sibling has to reach into.
   */
  readonly kind: 'email' | 'phone'
  readonly onKind: (kind: 'email' | 'phone') => void
}

/**
 * Said when the descriptor has not been read. Both arms need it — the code arm for
 * the application it sends to, the credential arm for the org it authenticates in —
 * so they refuse in one voice rather than each inventing a sentence.
 */
const unread = 'cannot read the sign-in configuration for this application'

/**
 * The credential form: one identifier, and whichever credential arms IAM says this
 * application can complete.
 *
 * Every arm is derived from the ONE descriptor (`get-app-login`), never from a
 * local switch, because IAM has already ANDed each application switch with the
 * capability behind it — an `enableCodeSignin` it cannot deliver comes back false
 * (`loginView`, internal/oidc/frontdoor.go). So "offered" and "will complete" are
 * the same fact, read once.
 *
 * The identifier is ONE field whatever it holds. IAM resolves a name, then an
 * email, then a phone number (`resolveLoginUser`), so the toggle changes what the
 * field is LABELLED and which keyboard it summons — never the wire, where the
 * identifier always travels plainly as `username`. It deliberately does not
 * normalize a number either: the account lookup already does (`store.NormalizePhone`
 * inside `GetUserByPhone`), and a second normalizer is how two spellings of one
 * number stop agreeing.
 */
/* The country and formatting rules are 143 kB of metadata for 245 countries, and
   only this one arm reads them — so they load when somebody chooses Phone, not on
   every sign-in. Loading them eagerly put 34 kB gz on the default path for a field
   most people never open. The fallback is the field's own height so the form does
   not jump while the chunk arrives. */
const PhoneField = lazy(() => import('./PhoneField').then((m) => ({ default: m.PhoneField })))

export function LoginForm(props: LoginFormProps) {
  const { client } = props
  const [identifier, setIdentifier] = useState('')
  const { kind } = props
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  // Which credential the person ASKED to give. What they can actually give is
  // decided below, by the descriptor.
  const [chosen, setChosen] = useState<'password' | 'code'>('password')
  const [codeSent, setCodeSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [app, setApp] = useState<AppLogin | null>(null)
  const errorId = useId()

  // Authenticate against the ORG OF THE APP being logged into, not the portal's own
  // brand. When a downstream app initiates the login it passes its own `client_id`
  // (props.clientIdOverride); that app may live in a different org than this brand
  // portal — e.g. the admin-guard (client_id=hanzo-admin-guard) is in the `admin`
  // org, so its operators must resolve to the admin/* identity (owner=admin), NOT
  // this brand's hanzo/* row. get-app-login is the canonical clientId ->
  // {application, organization} map; resolve through it and post BOTH so IAM scopes
  // the credential check to the app's org.
  //
  // BOTH entry points resolve the same way — the downstream-app login
  // (clientIdOverride) and the brand portal's own bare sign-in. They used to differ:
  // the bare portal deliberately posted NO `organization` so IAM's cross-org
  // fallback landed a colliding identity (z@hanzo.ai exists in both `admin` and
  // `hanzo`) on admin/* and returned the full multi-org session.
  //
  // That is gone, on purpose, at the server. iam2 scopes every credential lookup to
  // one org and treats the collision it relied on as a defect — "the F-2 bug where
  // z@hanzo.ai collided across admin and hanzo" — because cross-org resolution
  // coupled lockout counters across rows and gave a brute-force oracle on the
  // superadmin. So it now REFUSES an org-less login with "organization, username and
  // password are required". It answers HTTP **200**, which the form then renders as
  // if the user's own password were wrong, and which every status-code monitor reads
  // as green — the apex form was dead on hanzo.id, lux.id, iam.hanzo.ai and pars.id
  // simultaneously.
  //
  // Read on mount rather than per submit: the arms below are drawn from the same
  // answer, so one read serves the render and the post.
  useEffect(() => {
    let cancelled = false
    client
      .getAppLogin(props.clientIdOverride ?? client.org.clientId)
      .then((a) => {
        if (!cancelled && a) setApp(a)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // One-shot: the app being signed into is fixed for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, props.clientIdOverride])

  async function onSend() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (!app) {
        setError(unread)
        return
      }
      // The SAME identifier string is sent here and posted at login: IAM keys the
      // verification record on the destination it was sent to, so the two must be
      // one value.
      const res = await client.sendCode({ dest: identifier, channel: kind, application: app.id })
      if (!res.ok) setError(res.error ?? 'send failed')
      else setCodeSent(true)
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    // The submit reports "not yet" instead of removing itself (see Submit), so a
    // press still reaches here and the precondition is refused where it is known.
    if (busy || !ready) return
    setBusy(true)
    setError(null)
    try {
      // The descriptor carries the org, and nothing else does. IAM refuses an
      // org-less login, so a post assembled without it is a request that CANNOT
      // succeed — and it comes back as "organization, username and password are
      // required", which lands in the same place a wrong password does and tells
      // the person to retype a credential that was never the problem. The fallback
      // that used to stand here read `client.org.loginOrg`, which no catalog row
      // sets on any host, so it was not a fallback at all: it dropped the field.
      // Refuse where the cause is known, exactly as the code arm above does.
      if (!app) {
        setError(unread)
        return
      }
      const res = await client.login({
        identifier,
        ...(arm === 'code' ? { code } : { password }),
        clientId: props.clientIdOverride ?? client.org.clientId,
        application: app.application,
        organization: app.organization,
        redirectUri: props.redirectUri,
        state: props.state,
        codeChallenge: props.codeChallenge,
        codeChallengeMethod: props.codeChallengeMethod,
        nonce: props.nonce,
      })
      if (res.error) {
        setError(res.error)
      } else if (res.mfaRequired) {
        props.onMfaRequired?.(res)
      } else if (props.onAuthenticated) {
        // Caller owns the next step (e.g. device approval) — suppress the
        // default navigation so we stay on-page.
        props.onAuthenticated(res)
      } else if (res.redirectUrl) {
        window.location.href = res.redirectUrl
      } else {
        props.onSuccess?.(res)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  // Until the descriptor lands, offer the credential every application has: a
  // password. Drawing nothing would leave an empty card on a slow read, and drawing
  // a code arm the server may refuse is the lie this whole surface is about.
  const passwordArm = app ? app.enablePassword : true
  const codeArm = app?.enableCodeSignin === true
  // With one arm there is nothing to choose, so the offer decides: an application
  // that checks no password shows the code arm without being asked.
  const arm = passwordArm ? chosen : codeArm ? 'code' : 'password'
  const ready = arm === 'code' ? code.length === 6 : true
  const invalid = error !== null

  return (
    <form onSubmit={onSubmit} className="hanzo-id-form" aria-busy={busy}>
      {/* Phone is its own control, not this one relabelled. A number needs the
          country stated — the dial code rides on it, and how the digits group is
          a fact about where the number lives. Everything else IAM resolves from
          one string (name, then email, then phone), so everything else is one
          field. */}
      {kind === 'phone' ? (
        <Suspense fallback={<div className="hanzo-id-phone-loading" aria-hidden="true" />}>
          <PhoneField label="Phone number" onChange={setIdentifier} invalid={invalid} describedBy={errorId} />
        </Suspense>
      ) : (
        <label className="hanzo-id-field">
          <span>Email or username</span>
          <input
            className="hanzo-id-input"
            type="text"
            autoComplete="username"
            aria-invalid={invalid || undefined}
            aria-describedby={errorId}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
          />
        </label>
      )}
      {/* The switch that used to live here — a text link reading "Use a phone
          number instead" — is now an entry in the sign-in strip, so every way in
          is a button in one column instead of one of them being a sentence under
          a field. What it does is unchanged: a phone number has ALWAYS worked as
          an identifier (IAM resolves name, then email, then phone) and this field
          has always posted it plainly; naming the field is what tells a person
          so, summons the number pad and lets a password manager fill the right
          thing. It still promises no message — with the code arm off, "phone"
          means only "my account is that number". */}
      {arm === 'password' && passwordArm ? (
        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          invalid={invalid}
          describedBy={errorId}
        />
      ) : null}
      {arm === 'code' ? (
        <>
          <label className="hanzo-id-field">
            <span>{kind === 'phone' ? 'SMS code' : 'Email code'}</span>
            <input
              className="hanzo-id-input"
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoComplete="one-time-code"
              data-arm="code"
              aria-invalid={invalid || undefined}
              aria-describedby={errorId}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
            />
          </label>
          <button type="button" className="hanzo-id-linkbtn" data-send-code="true" onClick={onSend}>
            {codeSent ? 'Send another code' : 'Send a code'}
          </button>
        </>
      ) : null}
      <Alert id={errorId} message={error} />
      <Submit busy={busy} label="Continue" busyLabel="Continuing…" ready={ready} />
      {/* The switch appears only when IAM says this application can BOTH check a
          password and deliver a code; with one arm there is nothing to switch to. */}
      {codeArm && passwordArm ? (
        <button
          type="button"
          className="hanzo-id-linkbtn"
          data-arm-switch="true"
          onClick={() => {
            setChosen((a) => (a === 'code' ? 'password' : 'code'))
            setError(null)
          }}
        >
          {arm === 'code' ? 'Use my password instead' : 'Send me a code instead'}
        </button>
      ) : null}
    </form>
  )
}
