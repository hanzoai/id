// Telemetry for the sign-in portal — pageviews, the sign-up funnel and errors,
// anonymous, via the ONE @hanzo/event client (POST /v1/event, the front door
// cloud fans out into the web / product / error lenses). No page tag, no second
// SDK.
//
// This surface reported NOTHING before this file existed, which is why the
// arrival->session funnel had no denominator: hanzo.id is where every property's
// visitor lands, and none of it was attributable.
//
// It is also an AUTH surface, so what is NOT here is deliberate:
//
//   - no identify(). Attribution here is anonymous; @hanzo/event stamps a
//     per-browser `anonymousId` that survives sign-up, so the visitor's
//     pre-signup pageviews still join to whoever they become once a
//     post-auth surface (chat/console) identifies them. Reading the IAM
//     subject would mean wiring this into the auth context for a join that
//     already happens downstream.
//   - no interaction autocapture (@hanzo/observe). Heat maps answer "where do
//     they click"; the question this funnel exists to answer is "did they get a
//     session", which pageviews answer completely. Autocapture on the login and
//     signup forms is capture surface bought for no funnel signal.
//   - no session replay, no input capture, no email/name.

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createAnalytics, type Transport } from '@hanzo/event'
import { AnalyticsProvider as EventProvider, usePageview } from '@hanzo/event/react'
import { ingestKey, loadRuntime, resolveOrg } from '@hanzo/id-shared'

const HOST = 'https://api.hanzo.ai'
const PRODUCT = 'id'

/** The client type, taken from the factory so no second declaration can drift. */
type Client = ReturnType<typeof createAnalytics>

/**
 * Routes whose URL carries an authentication artifact.
 *
 * `/callback` holds the OAuth authorization `code` and `state`; the device
 * verification URI holds a `user_code`. Both sit in the QUERY STRING, and
 * @hanzo/event stamps `url: window.location.href` onto every event it builds —
 * independently of the `path` a caller passes. So passing a clean pathname does
 * NOT keep the code out of the payload; only not emitting does. Measured against
 * the real client, a pageview from `/callback?code=…&state=…` put both values on
 * the wire in cleartext while `path` read a tidy `/callback`.
 *
 * The client's scrubber does not save this either — it redacts secret SHAPES
 * (JWTs, sk-/pk-/hk-, bearer, cloud keys, PANs) and an opaque authorization code
 * matches none of them.
 *
 * Neither route is a funnel step: both are transient machine hops that redirect
 * onward within a tick. The funnel is `/` -> `/login` -> `/onboarding`, and every
 * one of those still reports. Dropping these two costs no signal and removes the
 * entire class of credential leak. See analytics.test.ts.
 */
const AUTH_ARTIFACT = /^\/(callback|login\/oauth\/device)(\/|$)/

/** telemetryAllowed reports whether a path may emit at all. Pure. */
export function telemetryAllowed(pathname: string): boolean {
  return !AUTH_ARTIFACT.test(pathname)
}

/**
 * bare returns a batch with every location reduced to its path.
 *
 * A query string on an identity portal is an OIDC request and nothing else —
 * `client_id`, `redirect_uri`, `state`, `code_challenge`, `nonce`, and on the
 * callback the authorization code. `state` and `nonce` bind one request to one
 * visitor's session, and none of it is a measurement: `path` already carries the
 * part a funnel reads, so the whole class goes rather than a list of parameter
 * names that the next OIDC extension will not be on.
 *
 * BOTH location fields. `referrer` is the full address of the page before, an
 * app-initiated sign-up arrives from `/login` carrying that same request, and
 * first-touch attribution persists it — so one such arrival stamps the request
 * on every event for the rest of the visit, `url` or no `url`.
 *
 * The client's scrubber does not reach these: it redacts secret SHAPES (JWTs,
 * sk-/pk-/hk-, bearer, cloud keys, PANs) and an opaque OIDC parameter is none of
 * them. See analytics.test.ts, which measures both halves.
 */
export function bare(body: string): string {
  const wire = JSON.parse(body) as { batch: { url?: string; referrer?: string }[] }
  const path = (u: string) => u.split(/[?#]/)[0]!
  for (const e of wire.batch) {
    if (e.url) e.url = path(e.url)
    if (e.referrer) e.referrer = path(e.referrer)
  }
  return JSON.stringify(wire)
}

/**
 * The door every event leaves by.
 *
 * A transport is the one place a surface decides what its own bytes look like:
 * @hanzo/event stamps `url` and `referrer` from `window.location` and
 * `document.referrer` inside `build()`, for every event and every call site, so
 * no argument passed at a call site keeps a query out of them.
 *
 * The send is the one the client asked for. `beacon` selects
 * `navigator.sendBeacon`, which is what survives the navigation a completed
 * sign-up performs, and a beacon carries no headers — so the publishable key
 * rides `?ingest_key` there and `Authorization` on fetch.
 */
const transport: Transport = {
  send(url, body, opts) {
    // The error plane names its own content type and rides whole. The event
    // stream is the JSON batch, and it leaves bared.
    const type = opts.contentType ?? 'application/json'
    const out = opts.contentType ? body : bare(body)
    if (opts.beacon && typeof navigator.sendBeacon === 'function') {
      const to = opts.ingestKey ? `${url}?ingest_key=${encodeURIComponent(opts.ingestKey)}` : url
      try {
        navigator.sendBeacon(to, new Blob([out], { type }))
        return
      } catch {
        /* the page is going; keepalive fetch is the other way out */
      }
    }
    const bearer = opts.ingestKey ?? opts.token
    const headers: Record<string, string> = { 'Content-Type': type }
    if (bearer) headers.Authorization = `Bearer ${bearer}`
    // Telemetry never throws back into the page it measures.
    void fetch(url, { method: 'POST', headers, body: out, keepalive: true, credentials: 'include' }).catch(
      () => {},
    )
  },
}

/**
 * consented honours an explicit browser opt-out — Global Privacy Control, then
 * legacy Do-Not-Track. This is the whole consent surface, and it suppresses
 * pageviews AND errors together: a visitor who opted out is not "mostly" off.
 * Pure with respect to its argument so the policy is testable without a DOM.
 */
export function consented(nav?: {
  globalPrivacyControl?: boolean
  doNotTrack?: string | null
}): boolean {
  if (!nav) return true
  if (nav.globalPrivacyControl === true) return false
  const dnt = nav.doNotTrack
  return dnt !== '1' && dnt !== 'yes'
}

/** Reads the live opt-out signals off `navigator`, or none outside a browser. */
function browserConsent(): boolean {
  if (typeof navigator === 'undefined') return true
  return consented(navigator as Navigator & { globalPrivacyControl?: boolean })
}

/**
 * Fires a pageview on SPA route changes.
 *
 * Inert today, and deliberately kept: this app navigates with
 * `window.location.assign/replace`, so every route change is a fresh document
 * and the provider's own initial pageview counts each page exactly once
 * (`usePageview` skips its first mount for precisely that reason — it would
 * otherwise double-count). `@tanstack/react-router` is a declared dependency
 * that nothing imports; the day someone mounts it, navigation stops reloading
 * the document and this is what keeps pageviews from silently going to zero.
 *
 * It is fed the PATHNAME, never `location.href`, and only when the path is
 * allowed to emit — `usePageview` no-ops on a null path.
 */
function RouteViews() {
  const [pathname, setPathname] = useState(() =>
    typeof window === 'undefined' ? '/' : window.location.pathname,
  )
  useEffect(() => {
    const sync = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])
  usePageview(telemetryAllowed(pathname) ? pathname : null)
  return null
}

/** An inert client: enabled:false stops init, enqueue, flush and the error handlers alike. */
function silent(): Client {
  return createAnalytics({ product: PRODUCT, host: HOST, enabled: false })
}

/**
 * Mounts the client for THIS BRAND.
 *
 * The key is resolved from the host the request arrived on, not from the build.
 * One image serves every brand's identity host, so a key chosen at build time is
 * one brand's key on all of them — which is what filed Lux's, Zoo's, Osage's,
 * Pars' and Bootnode's visitors in Hanzo's project. The host already decides the
 * brand, the IAM application and the brand package through `resolveOrg`; the key
 * is one more fact about that same org, read from the same `/config.json` the
 * shell already loads.
 *
 * FAIL CLOSED. A host that resolves to no org, or an org the keyring does not
 * name, reports NOTHING and says so on the console. It must never fall back to
 * another brand's key: that is silent, it reads as working, and it is only
 * visible later in a tenant that cannot explain the traffic.
 *
 * The provider is mounted from the first render with an INERT client and handed
 * the real one once the key is known. `AnalyticsProvider` builds its instance
 * from `client` alone, so swapping it is what makes the switch take effect —
 * and passing `children` through the same element both times is what keeps the
 * app from remounting (and re-running its whole boot) when it does.
 *
 * `RouteViews` waits for that swap, and the wait is load-bearing rather than
 * tidiness. `usePageview` suppresses only its FIRST run, so a hook already
 * mounted when the client changes sees its dependency change with the skip
 * already spent and fires — on top of the provider's own initial pageview.
 * Mounted after the swap it starts fresh against the live client, skips once,
 * and the document is counted exactly once. Measured: every pageview arrived
 * TWICE, with distinct ids, until this waited.
 */
export function Analytics({ children }: { children: ReactNode }) {
  const pathname = typeof window === 'undefined' ? '/' : window.location.pathname

  // Evaluated once per document, which is exact here BECAUSE navigation is
  // full-page: the path a document is loaded at is the path it dies at, so there
  // is no window in which a `/callback` load is measured under an earlier
  // route's decision.
  const allowed = browserConsent() && telemetryAllowed(pathname)

  const [client, setClient] = useState<Client>(silent)
  const [live, setLive] = useState(false)

  useEffect(() => {
    // An opted-out visitor, or a route carrying a credential: never fetch, never
    // resolve, never emit.
    if (!allowed) return
    let cancelled = false
    void loadRuntime().then((runtime) => {
      if (cancelled) return
      const host = window.location.hostname
      const org = resolveOrg(host, { catalog: runtime.catalog }).orgId
      const key = ingestKey(org, runtime.keyring)
      if (!key) {
        console.error(
          `[event] ${host} resolves to org "${org}" and no ingest key names it — this host reports nothing rather than reporting as another brand`,
        )
        return
      }
      setClient(createAnalytics({ product: PRODUCT, host: HOST, ingestKey: key, enabled: true, transport }))
      setLive(true)
    })
    return () => {
      cancelled = true
    }
  }, [allowed])

  return (
    <EventProvider client={client}>
      {live ? <RouteViews /> : null}
      {children}
    </EventProvider>
  )
}
