import { createContext, lazy, Suspense, type ReactNode } from 'react'
import { legal, type Brand, type Org } from '@hanzo/id-shared'

/**
 * Where the cookie choice appears, and what it links to.
 *
 * The banner and its footer link load on their own chunk: they render on
 * @hanzo/gui and react-native-web, which the sign-in form does not need, so the
 * form paints without waiting for them. The shell (App) mounts both; a page
 * only reserves the footer's place for the link (`Settings`).
 */
const banner = () => import('./banner')
const LazyBanner = lazy(() => banner().then((m) => ({ default: m.Banner })))
const LazySettings = lazy(() => banner().then((m) => ({ default: m.Settings })))

/**
 * The brand's own page that says what the banner asks about: its privacy
 * policy, else its terms where the brand publishes the two as one (zoo.ngo's
 * /terms is its Privacy Policy).
 *
 * Undefined for a brand that publishes neither, and such a host is not asked:
 * a choice made without the brand's own policy to read is not an informed one,
 * and the banner's default names Hanzo's, which is never another brand's to
 * show. Not asked means not allowed, so nothing optional runs there.
 */
export function policy(brand: { name: string }, org?: Org): string | undefined {
  const { privacy, terms } = legal(brand, org)
  return privacy ?? terms
}

/** The banner, drawn by the shared @hanzo/ui component once its chunk arrives. */
export function ConsentBanner({ brand, privacy }: { brand: Brand; privacy: string }) {
  return (
    <Suspense fallback={null}>
      <LazyBanner brand={brand.name} privacy={privacy} />
    </Suspense>
  )
}

/** "Cookie settings", which reopens the choices. */
export function ConsentSettings() {
  return (
    <Suspense fallback={null}>
      <LazySettings />
    </Suspense>
  )
}

/** The footer's "Cookie settings", which the shell supplies on a host it asks. */
export const Settings = createContext<ReactNode>(null)
