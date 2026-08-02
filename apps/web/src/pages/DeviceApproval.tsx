import { useEffect, useState, type ReactNode } from 'react'
import type { BrandContract } from '@hanzo/id-shared'
import { LoginForm, SocialButtons, type AuthClient } from '@hanzo/id-auth'
import { BrandHeader } from '../components/BrandHeader'

/**
 * RFC 8628 device-authorization approval (`/login/oauth/device`).
 *
 * The terminal leg of `dev login --device-auth`: the CLI shows a short
 * `user_code` and sends the human here (the IAM `verification_uri`;
 * `verification_uri_complete` adds `?user_code=<code>`). The human signs in to
 * the SAME issuer, confirms the code matches what their device shows, and
 * approves — which flips the device code's `UserSignIn=true` so the CLI's token
 * poll completes.
 *
 * Auth is reused, never reimplemented: not-signed-in renders the normal
 * `<LoginForm>` + `<SocialButtons>`; once the issuer session cookie is set the
 * page reads it back from `/v1/iam/get-account` and shows the confirm step.
 * Approval rides that session cookie (`client.approveDevice`), so no token ever
 * touches the URL or logs.
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
  const appLabel = client.tenant.appName

  // Resolve the issuer session: signed in → confirm, else → sign-in form. Reads
  // same-origin from `/v1/iam/get-account` (cookie session; the brand `*.id`
  // host IS `iamUrl`, so the cookie rides along) — identical to the Portal.
  useEffect(() => {
    scrubUrl()
    let alive = true
    fetch(new URL('/v1/iam/get-account', client.tenant.iamUrl).toString(), {
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
  }, [client.tenant.iamUrl])

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

  return (
    <Shell brand={brand}>
      <h1>Approve this device</h1>
      {email ? <p className="lede">Signed in as {email}</p> : null}

      <p className="hanzo-id-device-prompt">
        You are about to authorize <strong>{appLabel}</strong> to sign in on a device. Approve
        ONLY if this code matches the one shown on that device.
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
          onChange={(e) => setUserCode(e.target.value)}
          placeholder="e.g. K7M4P2QH"
          disabled={busy}
        />
      </label>

      {consent ? (
        <p className="hanzo-id-info">
          {brand.name} needs your consent to continue. By approving you grant {appLabel} access to
          your profile.
        </p>
      ) : null}

      {error ? <p role="alert" className="hanzo-id-error">{error}</p> : null}

      <div className="hanzo-id-cta-row">
        <button
          type="button"
          className="hanzo-id-btn"
          disabled={busy || userCode.trim().length === 0}
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
