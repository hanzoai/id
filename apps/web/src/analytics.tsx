// Telemetry for the sign-in portal — pageviews, the sign-up funnel and errors,
// anonymous, via the ONE @hanzo/event client (POST /v1/event, the front door
// cloud fans out into the web / product / error lenses), and the brand's browser
// tags through @hanzo/event's tag manager. index.html carries no tag of its own.
//
// Nothing here runs before the visitor chooses. The choice is @hanzo/event's
// (`hz_consent`, drawn by the @hanzo/ui banner App mounts): until it allows
// Analytics there is no client, and until it allows Analytics or Marketing the
// tag manager is not started, so not even the brand's tag config is fetched.
// Global Privacy Control and Do Not Track are a refusal the library reads
// itself, so a browser sending either is never asked and nothing starts.
//
// Attribution is anonymous until an account exists. There is exactly ONE moment
// that changes — a completed sign-up, where `Signup` calls `identify()` with the
// new account's IAM subject (the same value that arrives later as the OIDC
// `sub`). That single call is what joins the anonymous arrival to the person it
// produced; without it the visit and the account are two records nothing
// connects. It carries the subject and no traits.
//
// It is also an AUTH surface, so what is NOT here is deliberate:
//
//   - no interaction autocapture (@hanzo/observe). Heat maps answer "where do
//     they click"; the question this funnel exists to answer is "did they get a
//     session", which pageviews answer completely. Autocapture on the login and
//     signup forms is capture surface bought for no funnel signal.
//   - no session replay, no input capture, no email/name.

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createAnalytics, ORG_DOMAIN, startTags, type Transport } from '@hanzo/event'
import { AnalyticsProvider as EventProvider, useConsent, usePageview } from '@hanzo/event/react'
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
 * NOT keep the artifact out of the payload; only not emitting does.
 *
 * The client's own redaction does not close this either. It redacts a query
 * value by the NAME it is filed under — `code`, `state`, `nonce`, `token` and a
 * list more — and `user_code` is not on that list: measured against the real
 * client, a pageview from `/login/oauth/device?user_code=…` put the code on the
 * wire in cleartext while `path` read a tidy `/login/oauth/device`. No list
 * names every parameter an identity flow will carry, so the rule here is the
 * ROUTE, not a name.
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
 * And the `url` PROPERTY: `track()` stamps the page's full address into the
 * properties of the moment it states, beside the two fields above.
 *
 * The client's own redaction reaches some of these and not the rest: it works
 * by NAME, so `state`, `nonce` and `code_challenge` leave as `[redacted]` while
 * `client_id` and `redirect_uri` ride through untouched. See
 * funnel.wire.test.tsx, which sends the same view with and without this.
 */
export function bare(body: string): string {
  const wire = JSON.parse(body) as {
    batch: { url?: string; referrer?: string; properties?: { url?: unknown } }[]
  }
  const path = (u: string) => u.split(/[?#]/)[0]!
  for (const e of wire.batch) {
    if (e.url) e.url = path(e.url)
    if (e.referrer) e.referrer = path(e.referrer)
    if (typeof e.properties?.url === 'string') e.properties.url = path(e.properties.url)
  }
  return JSON.stringify(wire)
}

/**
 * The content type a page-unload beacon labels its body with.
 *
 * A cross-origin POST is preflighted unless its content type is one of the three
 * CORS-simple ones, and a preflight is a second round trip. A beacon is issued
 * while the document is being torn down, which is exactly when there is no second
 * round trip to be had — so a beacon that must be preflighted is abandoned, and
 * the batch it carried is the whole sign-up funnel. `text/plain` keeps the
 * request simple and it goes in one hop.
 *
 * The bytes are the same JSON either way; this is a label. The ingest reads the
 * body it is handed rather than dispatching on the header — measured against
 * production, a `text/plain` batch answers `{"accepted":1,"dropped":0}` — so
 * nothing on the server side is relaxed to accept it.
 *
 * The fetch below still names `application/json`, which is true there and costs
 * nothing: a send that is not racing an unload can afford the preflight.
 */
const BEACON_TYPE = 'text/plain'

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
        navigator.sendBeacon(to, new Blob([out], { type: BEACON_TYPE }))
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
 * The brand this host serves and its publishable key, or no key when the
 * runtime keyring names none.
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
 */
export async function brandKey(host: string): Promise<{ org: string; key?: string }> {
  const runtime = await loadRuntime()
  const org = resolveOrg(host, { catalog: runtime.catalog }).orgId
  const key = ingestKey(org, runtime.keyring)
  if (!key) {
    console.error(
      `[event] ${host} resolves to org "${org}" and no ingest key names it — this host reports nothing rather than reporting as another brand`,
    )
  }
  return { org, key }
}

/**
 * Mounts the client and starts the tag manager for THIS BRAND, once the visitor
 * allows it.
 *
 * ONE key for both. The stream files its events under the brand's key, and the
 * tag manager asks cloud for the tag set of the project that same key names
 * (`GET /v1/project/tags?key=`), so a brand's page loads that brand's GA4 and
 * pixels and no other's. A host with no key starts neither.
 *
 * The visitor's choice decides each half: the stream needs Analytics, the tag
 * manager needs Analytics or Marketing and then loads only the tags the choice
 * covers. A route whose URL carries a credential starts neither, whatever was
 * chosen — the tags would read the address too. GA4's cross-domain linker gets
 * the brand's own domains, so a visit that crosses from the brand's site to its
 * identity host stays one session and never joins another brand's.
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
 * and the document is counted exactly once.
 */
export function Analytics({ children }: { children: ReactNode }) {
  const pathname = typeof window === 'undefined' ? '/' : window.location.pathname
  const choice = useConsent()

  // The route is read once per document, which is exact BECAUSE navigation is
  // full-page: the path a document is loaded at is the path it dies at, so there
  // is no window in which a `/callback` load is measured under an earlier
  // route's decision.
  const route = telemetryAllowed(pathname)
  const measured = route && choice.analytics
  const tagged = route && (choice.analytics || choice.marketing)

  const [client, setClient] = useState<Client>(silent)
  const [live, setLive] = useState(false)

  useEffect(() => {
    if (!tagged) return
    let cancelled = false
    let stop: (() => void) | undefined
    const host = window.location.hostname
    void brandKey(host).then(({ org, key }) => {
      if (cancelled || !key) return
      const domains = ORG_DOMAIN[org]
      stop = startTags({ key, host, domains: domains && [...domains] })
      if (!measured) return
      setClient(createAnalytics({ product: PRODUCT, host: HOST, ingestKey: key, enabled: true, transport }))
      setLive(true)
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [tagged, measured])

  // A withdrawal of Analytics after the client started reloads the page once,
  // as the tag manager does for a tag that ran: the client keeps its error and
  // unload listeners for the life of the document, and only a new document,
  // which starts none, is sure to send nothing.
  useEffect(() => {
    if (live && !measured) window.location.reload()
  }, [live, measured])

  return (
    <EventProvider client={client}>
      {live ? <RouteViews /> : null}
      {children}
    </EventProvider>
  )
}
