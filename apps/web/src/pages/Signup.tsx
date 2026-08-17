import { useEffect, useRef, useState } from 'react'
import { EVENTS } from '@hanzo/event'
import { useAnalytics } from '@hanzo/event/react'
import type { BrandContract } from '@hanzo/id-shared'
import { SignupForm, SocialButtons, type AuthClient } from '@hanzo/id-auth'
import { BrandFooter } from '../components/BrandFooter'
import { clientIdFrom } from '../route'

export function Signup({ client, brand }: { client: AuthClient; brand: BrandContract }) {
  const sp = new URLSearchParams(window.location.search)
  const clientIdOverride = clientIdFrom(window.location.search, window.location.pathname)
  const redirectUri = sp.get('redirect_uri') ?? undefined
  // The same downstream OIDC request `Login` reads. Registration ends in a
  // sign-in, so it needs the whole request — not just the client and its
  // callback — or the minted code carries no PKCE binding and no state.
  const state = sp.get('state') ?? undefined
  const codeChallenge = sp.get('code_challenge') ?? undefined
  const codeChallengeMethod = (sp.get('code_challenge_method') as 'S256' | 'plain' | null) ?? undefined
  const nonce = sp.get('nonce') ?? undefined

  // Only ask for credentials an account can actually be made with. IAM refuses
  // signup on an app with `enableSignUp:false` — 48 of 51 hanzo applications
  // today — and it refuses at SUBMIT, so this page used to take an email and a
  // password and only then answer "the application does not allow to sign up
  // new account". The provider buttons dead-end the same way: federation
  // PROVISIONS a local user for a new identity, so a first-time GitHub sign-up
  // hits the same gate after a whole round trip through GitHub.
  //
  // `enableSignUp` is already on `AppLogin` and already fetched — SignupForm
  // reads the same row inside onSubmit. Reading it here instead is what turns
  // the refusal from a surprise into a state.
  //
  // It FAILS OPEN, deliberately: an unreadable app config renders the form, and
  // the server still refuses. This is honesty about a known answer, not a gate —
  // the gate is `internal/oidc/signup.go` and must stay the only one.
  const [open, setOpen] = useState(true)
  useEffect(() => {
    let cancelled = false
    client
      .getAppLogin(clientIdOverride, redirectUri)
      .then((app) => {
        if (!cancelled && app) setOpen(app.enableSignUp)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [client, clientIdOverride, redirectUri])

  // The page was reached. Counted before the application answers whether it
  // takes new accounts at all, so an application that refuses is a measured
  // outcome rather than a hole in the funnel.
  //
  // Keyed on the client because the provider starts inert and hands over a live
  // one once the brand's ingest key resolves — the inert one counts nothing, and
  // once per client is what makes this once on the wire: StrictMode's second
  // effect sees the same client and skips.
  const analytics = useAnalytics()
  const counted = useRef<unknown>(null)
  useEffect(() => {
    if (counted.current === analytics) return
    counted.current = analytics
    analytics.capture(EVENTS.SIGNUP_VIEWED)
  }, [analytics])

  if (!open) {
    return (
      <div className="hanzo-id-page hanzo-id-signup">
        <main>
          <h1>Create your {brand.name} account</h1>
          <p className="hanzo-id-info">
            This application does not accept new accounts. If you already have
            one, sign in below.
          </p>
          <p className="hanzo-id-footer-links">
            <a href={`/login${window.location.search}`}>Sign in</a>
          </p>
        </main>
        <BrandFooter brand={brand} org={client.org} />
      </div>
    )
  }

  return (
    <div className="hanzo-id-page hanzo-id-signup">
      <main>
        <h1>Create your {brand.name} account</h1>
        <SocialButtons
          client={client}
          clientIdOverride={clientIdOverride}
          intent="signup"
          postLoginRedirect={redirectUri}
        >
          <SignupForm
            client={client}
            clientIdOverride={clientIdOverride}
            redirectUri={redirectUri}
            state={state}
            codeChallenge={codeChallenge}
            codeChallengeMethod={codeChallengeMethod}
            nonce={nonce}
            onSubmitted={() => {
              analytics.capture(EVENTS.SIGNUP_SUBMITTED)
              // Send it on an ordinary request, now. Creating the account is a
              // full round trip and the browser leaves for the app the moment it
              // answers, so a step left on the flush timer only ever leaves on the
              // unload beacon — the send that is lost when a tab is closed or the
              // network stalls, and the one nothing can read back to check. The
              // arrival is still buffered at this point, so it rides out here too,
              // and the two steps the funnel is measured on stop depending on a
              // page that is already going away.
              analytics.flush()
            }}
            onCompleted={(subject) => {
              // The visitor now has a name, so bind it BEFORE counting the
              // completion: `identify` stamps the subject on this event and on
              // everything after it, and emits the row that joins the anonymous
              // arrival to the account it produced. The steps already queued keep
              // the anonymous id they happened under, which is what they were.
              //
              // The subject alone — an opaque IAM id, no traits. The address is on
              // the form a few lines above and has no business on this wire.
              if (subject) analytics.identify(subject)
              analytics.capture(EVENTS.SIGNUP_COMPLETED)
              // The browser leaves for the app on the next line, so the whole
              // buffer goes now rather than waiting on the flush timer.
              analytics.flush(true)
            }}
          />
        </SocialButtons>
        <p className="hanzo-id-footer-links">
          Already have an account? <a href={`/login${window.location.search}`}>Sign in</a>
        </p>
      </main>
      <BrandFooter brand={brand} org={client.org} />
    </div>
  )
}
