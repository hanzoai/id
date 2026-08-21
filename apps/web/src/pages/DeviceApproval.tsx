import { useEffect, useState, type ReactNode } from 'react'
import type { BrandContract } from '@hanzo/id-shared'
import { LoginForm, SocialButtons, type AuthClient, type DeviceInfoResult } from '@hanzo/id-auth'
import { BrandHeader } from '../components/BrandHeader'

/**
 * RFC 8628 device-authorization approval (`/login/oauth/device`).
 *
 * The terminal leg of `hanzo login`: the CLI shows a short `user_code` and sends
 * the human here (the IAM `verification_uri`; `verification_uri_complete`
 * appends the code as a PATH segment, `/login/oauth/device/<code>` — IAM builds
 * it that way because that is the route this page is registered on, and
 * `readUserCode` accepts the `?user_code=` query form too). The human signs in
 * to the SAME issuer, confirms the code matches what their device shows, and
 * approves — which binds their identity onto the pending row (`Token.User`,
 * owner/name) so the CLI's token poll stops answering `authorization_pending`
 * and mints. There is no `UserSignIn` flag; an empty `User` IS "not yet
 * approved".
 *
 * Auth is reused, never reimplemented: not-signed-in renders the normal
 * `<LoginForm>` + `<SocialButtons>`; once the issuer session cookie is set the
 * page reads it back from `/v1/iam/account` and shows the confirm step.
 * Approval rides that session cookie (`client.approveDevice`), so no token ever
 * touches the URL or logs.
 *
 * The screen exists to answer ONE question — which application am I authorizing?
 * — so the application it names is read from the code (`client.deviceInfo`) and
 * from nowhere else. Until IAM has named one there is no name on screen and no
 * button to press.
 */

type Phase =
  | { s: 'checking' }
  | { s: 'signin' }
  | { s: 'confirm'; email?: string }
  | { s: 'consent'; email?: string }
  | { s: 'approving' }
  | { s: 'approved' }

/** Read the user_code from `?user_code=` first, then a trailing path segment
 *  (`/login/oauth/device/<code>`) so both the complete and bare verification
 *  URIs work; absent → the user types it. */
function readUserCode(): string {
  const fromQuery = new URLSearchParams(window.location.search).get('user_code')
  if (fromQuery) return fromQuery
  const m = window.location.pathname.match(/\/login\/oauth\/device\/([^/?#]+)/)
  return m ? decodeURIComponent(m[1]!) : ''
}

/** A device-flow return must never leave tokens/codes sitting in the address
 *  bar (history, referrer, shoulder-surf). Strip everything but `user_code`. */
function scrubUrl() {
  const url = new URL(window.location.href)
  let changed = false
  for (const k of ['access_token', 'refresh_token', 'id_token', 'code', 'state']) {
    if (url.searchParams.has(k)) {
      url.searchParams.delete(k)
      changed = true
    }
  }
  if (changed) window.history.replaceState({}, '', url.toString())
}

export function DeviceApproval({ client, brand }: { client: AuthClient; brand: BrandContract }) {
  const [phase, setPhase] = useState<Phase>({ s: 'checking' })
  const [userCode, setUserCode] = useState(() => readUserCode())
  // The code is prefilled from `?user_code=` and stays EDITABLE, which is the
  // anti-phishing property that matters: approving is an explicit click on a
  // code the human can read and correct against what their own device shows.
  // There was also a "I started this sign-in" checkbox in front of that click.
  // No device page anyone actually uses has one — Google, GitHub and AWS all
  // show the code and an Approve button — and a tickbox is not evidence: a
  // victim being walked through a crafted link ticks it as readily as they
  // click Approve. It bought nothing and cost every honest user a step.
  const [error, setError] = useState<string | null>(null)
  // WHICH application is asking — the whole point of this screen, and the one
  // thing the page cannot know on its own. It used to render `org.appName`: this
  // PORTAL's own branding, a static per-org string, so a sign-in started by
  // hanzo-cli was approved under a screen reading "hanzo-console". The client is
  // a property of the CODE (it lives on the pending row and is what the backend
  // actually approves), so it is read from the code — `client.deviceInfo`,
  // IAM `POST /v1/iam/oauth/device/info`.
  //
  // That read is session-gated and answers with one opaque refusal for unknown /
  // expired / already-approved, so it is no oracle for hunting live codes: it
  // tells a caller strictly less than the approval that same caller could already
  // attempt.
  //
  // null = not resolved yet. NOTHING is rendered in its place — no fallback name,
  // no portal name, no guess. Naming the wrong party is the defect being fixed
  // here, and a screen that names none is strictly better than one that lies.
  const [app, setApp] = useState<DeviceInfoResult | null>(null)
  const named = app?.ok ? app : null

  // Resolve the issuer session: signed in → confirm, else → sign-in form. Reads
  // same-origin from `/v1/iam/account` (cookie session; the brand `*.id`
  // host IS `iamUrl`, so the cookie rides along) — identical to the Portal.
  useEffect(() => {
    scrubUrl()
    let alive = true
    fetch(new URL('/v1/iam/account', client.org.iamUrl).toString(), {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then((r) => r.json())
      .then((b: Record<string, unknown>) => {
        if (!alive) return
        const d = b.data as Record<string, unknown> | undefined
        if (b.status === 'ok' && d && typeof d === 'object') {
          setPhase({ s: 'confirm', email: str(d.email) ?? str(d.name) })
        } else {
          setPhase({ s: 'signin' })
        }
      })
      .catch(() => {
        if (alive) setPhase({ s: 'signin' })
      })
    return () => {
      alive = false
    }
  }, [client.org.iamUrl])

  // Ask WHICH application the code belongs to. Needs both halves of what the
  // endpoint is gated on: the issuer session (every phase past the check has one
  // except `signin`, and the boolean keeps consent/approving from re-asking) and
  // a code to ask about.
  //
  // The debounce is what makes a hand-typed code work: each keystroke is a
  // different code, and a partial one is not a real code — without it the human
  // watches IAM's refusal flash at them while they are still typing.
  const signedIn = phase.s !== 'checking' && phase.s !== 'signin'
  const blank = userCode.trim().length === 0
  useEffect(() => {
    if (!signedIn || blank) return
    let alive = true
    const t = setTimeout(() => {
      client.deviceInfo(userCode).then((r) => {
        if (!alive) return
        // The session lapsed between the get-account check and this read. The
        // signin phase preserves the code in `returnTo`, so the human lands back
        // here with it intact.
        if (!r.ok && r.loginRequired) setPhase({ s: 'signin' })
        else setApp(r)
      })
    }, 250)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [client, userCode, signedIn, blank])

  async function approve() {
    setError(null)
    setPhase({ s: 'approving' })
    const res = await client.approveDevice(userCode)
    if (res.ok) {
      setPhase({ s: 'approved' })
    } else if (res.required) {
      setPhase({ s: 'consent' })
    } else {
      setError(res.error ?? 'Approval failed. Restart sign-in on your device.')
      setPhase({ s: 'confirm' })
    }
  }

  if (phase.s === 'checking') {
    return (
      <Shell brand={brand}>
        <div className="hanzo-id-spinner" style={{ borderTopColor: brand.accentColor ?? '#fff' }} />
      </Shell>
    )
  }

  if (phase.s === 'signin') {
    // Sign in first (reuse the normal flow). The password leg stays on-page via
    // `onAuthenticated` and re-checks the session; the social leg round-trips and
    // returns to THIS page (postLoginRedirect), where the session check resumes.
    const returnTo = userCode
      ? `${window.location.pathname}?user_code=${encodeURIComponent(userCode)}`
      : window.location.pathname
    return (
      <Shell brand={brand}>
        <h1>Sign in to approve your device</h1>
        <SocialButtons client={client} intent="signin" postLoginRedirect={returnTo} />
        <LoginForm client={client} onAuthenticated={() => setPhase({ s: 'confirm' })} />
        <p className="hanzo-id-footer-links">
          <a href="/forget">Forgot password?</a>
        </p>
      </Shell>
    )
  }

  if (phase.s === 'approved') {
    return (
      <Shell brand={brand}>
        <h1>You're signed in on your device</h1>
        <p className="lede">Approval complete — you can close this window and return to your device.</p>
      </Shell>
    )
  }

  const busy = phase.s === 'approving'
  const consent = phase.s === 'consent'
  const email = phase.s === 'confirm' || phase.s === 'consent' ? phase.email : undefined
  // ONE place shows a failure, whichever leg produced it: the approval itself, or
  // the lookup that has to name an application before an approval is offered.
  const failure = error ?? (app && !app.ok ? app.error : null)

  return (
    <Shell brand={brand}>
      <h1>Approve this device</h1>
      {email ? <p className="lede">Signed in as {email}</p> : null}

      {/* The application is named ONLY once IAM has confirmed it — the clientId
          alongside the display name, so a technical human can check it reads
          `hanzo-cli` exactly and not something that merely looks like it. Until
          then the sentence says a device, because that is all the page knows. */}
      <p className="hanzo-id-device-prompt">
        {named ? (
          <>
            <strong>{named.displayName}</strong> (<code>{named.clientId}</code>) is asking to
            sign in as you.
          </>
        ) : (
          'A device is asking to sign in as you.'
        )}{' '}
        Approve ONLY if the code below matches the one shown on that device, and only if you
        started this sign-in yourself.
      </p>

      <label className="hanzo-id-field">
        <span>Device code</span>
        <input
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="one-time-code"
          aria-label="Device code"
          className="hanzo-id-input hanzo-id-device-code"
          value={userCode}
          // A name — and a failure — belongs to a CODE. Edit the code and both are
          // dropped in the same commit, so no name is ever left on screen for a
          // frame beside a code it was not confirmed for.
          onChange={(e) => {
            setUserCode(e.target.value)
            setApp(null)
            setError(null)
          }}
          placeholder="e.g. K7M4P2QH"
          disabled={busy}
        />
      </label>

      {consent && named ? (
        <p className="hanzo-id-info">
          <strong>{named.displayName}</strong> needs your consent to continue. By approving
          you grant the device showing this code access to your profile.
        </p>
      ) : null}

      {failure ? <p role="alert" className="hanzo-id-error">{failure}</p> : null}

      <div className="hanzo-id-cta-row">
        <button
          type="button"
          // Nothing is approved until IAM has named what is being approved. An
          // unresolved or refused lookup leaves no button to press, rather than a
          // button that authorizes an unnamed party.
          className="hanzo-id-btn"
          disabled={busy || !named}
          onClick={approve}
        >
          {busy ? 'Approving…' : consent ? 'Approve & grant access' : 'Approve'}
        </button>
      </div>
    </Shell>
  )
}

function Shell({ brand, children }: { brand: BrandContract; children: ReactNode }) {
  return (
    <div className="hanzo-id-page hanzo-id-device">
      <BrandHeader brand={brand} />
      <main>{children}</main>
    </div>
  )
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}
