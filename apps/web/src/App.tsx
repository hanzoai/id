import { useEffect, useMemo, useState } from 'react'
import { loadBrand, catalogOf, parseCatalog, resolveOrg, aliasRedirect, idBrandLabel, type BrandContract, type OrgConfig } from '@hanzo/id-shared'
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
 * Top-level wiring. Resolves org + brand once on mount, then routes via
 * `window.location.pathname`. No router lib needed — this app is 5 pages,
 * `<a href>` is enough. Adding paths is a switch case.
 */
export function App() {
  const [org, setOrg] = useState<OrgConfig | null>(null)
  const [brand, setBrand] = useState<BrandContract | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function boot() {
      // The runtime serves the per-host org catalog at /config.json — NOT a
      // `window.__ID_CATALOG__` global, which the runtime never injects
      // (relying on it silently dropped every catalog-only host, e.g. osage.id,
      // to the bundled Hanzo default). Fall back to the global, then empty, so a
      // host always resolves to something.
      //
      // `catalogOf` owns which key that payload uses — the name is the server's,
      // not ours (see its doc). Reading the wrong one is a silent total-catalog
      // outage, so it is pinned by a test next to the resolver it feeds.
      let catalogRaw: string | undefined
      try {
        const res = await fetch('/config.json', { cache: 'no-store' })
        if (res.ok) catalogRaw = catalogOf(await res.json())
      } catch {
        // network/parse error → fall back below
      }
      if (!catalogRaw) {
        catalogRaw = (window as unknown as { __ID_CATALOG__?: string }).__ID_CATALOG__
      }
      const catalog = parseCatalog(catalogRaw)
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
  return <Portal client={client} brand={brand} org={org} />
}
