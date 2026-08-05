// Telemetry for the sign-in portal — pageviews and errors, anonymous, via the
// ONE @hanzo/event client (POST /v1/event, the front door cloud fans out into
// the web / product / error lenses). No page tag, no second SDK.
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
import { AnalyticsProvider as EventProvider, usePageview } from '@hanzo/event/react'

const HOST = 'https://api.hanzo.ai'

/**
 * Publishable ingest key (pk-…), inlined by Vite from the build env. Write-only:
 * it attributes a write to ONE org and mints no reading principal, which is what
 * makes it safe in a bundle — and it is the ONLY thing that attributes a
 * LOGGED-OUT visitor, which on a sign-in portal is nearly all of them.
 *
 * Absent is not a degraded mode: cloud takes an unkeyed beacon down the anonymous
 * lane and files it under `$public`, a tenant this org cannot read, and answers
 * 200 either way. The loss is silent on both ends, so the Dockerfile fails the
 * build rather than letting an empty value ship. Never hardcode a value here.
 */
const INGEST_KEY = import.meta.env.VITE_EVENT_INGEST_KEY?.trim() || undefined

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

/**
 * Mounts the client. `enabled` is the single gate every plane reads — it stops
 * init, enqueue, flush and the error handlers alike, so an off state emits
 * nothing at all rather than emitting less.
 *
 * The gate is evaluated once per document, which is exact here BECAUSE
 * navigation is full-page: the path a document is loaded at is the path it dies
 * at, so there is no window in which a `/callback` load is measured under an
 * earlier route's decision.
 */
export function Analytics({ children }: { children: ReactNode }) {
  const pathname = typeof window === 'undefined' ? '/' : window.location.pathname
  const enabled = browserConsent() && telemetryAllowed(pathname)

  return (
    <EventProvider config={{ product: 'id', host: HOST, ingestKey: INGEST_KEY, enabled }}>
      <RouteViews />
      {children}
    </EventProvider>
  )
}
