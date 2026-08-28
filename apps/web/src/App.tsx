import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { loadBrand, loadRuntime, resolveOrg, aliasRedirect, idBrandLabel, type Brand, type Org } from '@hanzo/id-shared'
import { Mark } from './components/Mark'
import { createAuthClient } from '@hanzo/id-auth'
import { Portal } from './pages/Portal'
import { Login } from './pages/Login'
import { Signup } from './pages/Signup'
import { Forgot } from './pages/Forgot'
import { Callback } from './pages/Callback'
import { Onboarding } from './pages/Onboarding'
import { DeviceApproval } from './pages/DeviceApproval'
import { Mfa } from './pages/Mfa'

/**
 * The account surface is the one page nobody signing in ever loads, and it
 * carries the shared chrome with it — so it is fetched when it is asked for
 * rather than added to the bundle every visitor downloads to type a password.
 */
const Account = lazy(() => import('./pages/Account').then((m) => ({ default: m.Account })))

/**
 * Top-level wiring. Resolves org + brand once on mount, then routes via
 * `window.location.pathname`. No router lib needed — this app is 5 pages,
 * `<a href>` is enough. Adding paths is a switch case.
 */
export function App() {
  const [org, setOrg] = useState<Org | null>(null)
  const [brand, setBrand] = useState<Brand | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function boot() {
      // The runtime serves the per-host org catalog at /config.json — NOT a
      // `window.__ID_CATALOG__` global, which the runtime never injects
      // (relying on it silently dropped every catalog-only host, e.g. osage.id,
      // to the bundled Hanzo default). `loadRuntime` owns that fetch, the
      // property names the server uses, and the fallbacks — for this shell and
      // for telemetry alike, from ONE request, so the two cannot resolve a host
      // to different brands.
      const { catalog } = await loadRuntime()
      const t = resolveOrg(window.location.hostname, { catalog })
      if (cancelled) return

      // An org reaches this portal on several hostnames and only one of them is
      // its front door. Send an alias there before anything renders — with the
      // path and query intact, so a sign-in keeps the OAuth request that sent
      // it. `replace`, not `assign`: Back must return to whoever linked here,
      // not to a host that would forward again.
      //
      // Before rendering, not after: a visible flash of one brand's page on the
      // way to another's is the thing this exists to stop.
      const elsewhere = aliasRedirect(
        catalog,
        t.orgId,
        window.location.origin,
        window.location.pathname,
        window.location.search,
      )
      if (elsewhere) {
        window.location.replace(elsewhere)
        return
      }

      setOrg(t)
      try {
        const b = await loadBrand(t.brandPackage)
        if (cancelled) return
        setBrand(b)
        document.title = idBrandLabel(b, t.orgId)
        const fav = document.getElementById('favicon') as HTMLLinkElement | null
        if (fav && b.faviconUrl) fav.href = b.faviconUrl
      } catch (e) {
        if (!cancelled) setError(String(e))
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [])

  const client = useMemo(() => (org ? createAuthClient({ org }) : null), [org])

  if (error) return <div className="hanzo-id-error">{error}</div>
  if (!org || !brand || !client) return <div>Loading…</div>

  // The mark is chrome and every page carries it, so the shell renders it once
  // and the routing table answers only WHICH page. It used to live inside each
  // page's footer, which meant nine copies of one fact.
  const page = (() => {
    const path = window.location.pathname
    // Device-authorization approval (RFC 8628). Must precede the `/login` catch
    // since it lives under `/login/oauth/device`.
    if (path === '/login/oauth/device' || path.startsWith('/login/oauth/device/'))
      return <DeviceApproval client={client} brand={brand} />
    // The second factor for a sign-in that came in through another identity
    // provider. IAM redirects here (`PathMfaVerify`) and holds the whole resume, so
    // it must precede the `/login` catch-all — under it, this address rendered the
    // credential form and no 2FA-enrolled person could finish a social sign-in.
    if (path === '/login/mfa' || path.startsWith('/login/mfa/')) return <Mfa client={client} brand={brand} />
    if (path === '/login' || path.startsWith('/login/')) return <Login client={client} brand={brand} />
    if (path === '/signup' || path.startsWith('/signup/')) return <Signup client={client} brand={brand} />
    if (path === '/forget' || path === '/forgot' || path.startsWith('/forg')) return <Forgot client={client} brand={brand} />
    if (path === '/callback' || path.startsWith('/callback/')) return <Callback org={org} brand={brand} />
    if (path === '/onboarding' || path.startsWith('/onboarding/'))
      return <Onboarding client={client} org={org} brand={brand} />
    if (path === '/account' || path.startsWith('/account/'))
      return (
        <Suspense fallback={<div className="hanzo-id-page" />}>
          <Account client={client} brand={brand} org={org} />
        </Suspense>
      )
    return <Portal client={client} brand={brand} org={org} />
  })()

  return (
    <>
      {/* The same label the tab already carries. A mark alone answers "which
          company" and leaves "which product" to be guessed — and this surface
          is one of several a person reaches from the same brand. */}
      {/* Except on the account surface, which carries the signed-in chrome and
          names the brand inside it — two marks in one corner is one too many. */}
      {window.location.pathname.startsWith('/account') ? null : (
        <Mark brand={brand} orgId={org?.orgId} />
      )}
      {page}
    </>
  )
}
