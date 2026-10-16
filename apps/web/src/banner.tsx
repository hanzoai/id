import { GuiProvider } from '@hanzo/gui'
import config from '@hanzo/ui/gui-config'
import { Consent, ConsentLink } from '@hanzo/ui/consent'

/**
 * The cookie choice, drawn by the ONE banner every Hanzo, Lux and Zoo site
 * mounts (`@hanzo/ui/consent`). The choice itself is @hanzo/event's, and
 * analytics.tsx starts nothing until it allows.
 *
 * Both render on @hanzo/gui, which nothing else on this portal uses, so each
 * carries its own provider rather than wrapping every page in one.
 */
export function Banner({ brand, privacy }: { brand: string; privacy: string }) {
  return (
    <GuiProvider config={config} defaultTheme="dark">
      <Consent brand={brand} privacy={privacy} />
    </GuiProvider>
  )
}

/** The footer link that reopens the choices. */
export function Settings() {
  return (
    <GuiProvider config={config} defaultTheme="dark">
      <ConsentLink />
    </GuiProvider>
  )
}
