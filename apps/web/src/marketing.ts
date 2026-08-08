/**
 * Per-org marketing content + app launcher links.
 *
 * The brand-neutral `BrandContract` (from `loadBrand`) carries only the
 * visual essentials (name, logo, accent). The split-view login's marketing
 * panel and the post-login apps launcher need richer, org-specific copy —
 * ported verbatim from the frozen `legacy-nextjs` design (`staticBranding`
 * content + `orgApps`). Keyed by `org.orgId` so it stays decoupled from
 * hostname switches; unknown orgs fall back to `hanzo`.
 */

export interface Quote {
  readonly text: string
  readonly author: string
  readonly role?: string
}

export interface Marketing {
  /** Pill above the hero ("✦ <tagline>"). */
  readonly tagline?: string
  /** Hero heading. */
  readonly title: string
  /** Hero subheading. */
  readonly subtitle: string
  /** Rotating testimonials. */
  readonly quotes: readonly Quote[]
}

export interface AppLink {
  readonly name: string
  readonly href: string
  readonly description: string
}

const MARKETING: Record<string, Marketing> = {
  hanzo: {
    tagline: 'AI-powered development',
    title: 'Start building in seconds',
    subtitle: 'Describe your idea and watch AI bring it to life instantly.',
    quotes: [
      { text: 'Hanzo is amazing. It is revolutionizing how we build and deploy applications.', author: 'Developer', role: 'Software Engineer' },
    ],
  },
  lux: {
    tagline: 'Lux-powered infrastructure',
    title: 'Start deploying in seconds',
    subtitle: 'High-performance blockchain infrastructure for the Lux ecosystem.',
    quotes: [
      { text: 'Lux is fast. We deploy chains in minutes, not weeks.', author: 'Validator', role: 'Node Operator' },
    ],
  },
  zoo: {
    tagline: 'Open AI research network',
    title: 'Build the future of DeAI',
    subtitle: 'Open AI research and decentralized science for everyone.',
    quotes: [
      { text: 'Zoo is where bleeding-edge DeAI experiments actually ship.', author: 'Researcher', role: 'ML Engineer' },
    ],
  },
  pars: {
    tagline: 'Sovereign digital identity',
    title: 'Welcome to Pars',
    subtitle: 'The decentralized network for the next generation.',
    quotes: [
      { text: 'Pars gives our community a sovereign, verifiable identity layer.', author: 'Member', role: 'Community Lead' },
    ],
  },
}

// The launcher lists PRODUCTS a person opens, not every host we run.
//
// Hanzo is three: App (build), Chat (talk), Cloud (the platform + its API).
// "Console" is NOT a fourth — it is Cloud's former name, and console.hanzo.ai
// now redirects to cloud.hanzo.ai, so listing both showed one product twice
// under two names and sent half the traffic through a redirect. It is gone;
// nothing here links to console.hanzo.ai.
//
// Analytics, Platform and Storage came out with it: s3.hanzo.ai answers a bare
// XML AccessDenied to a browser (it is an S3 API endpoint, not a page), and the
// other two are surfaces inside Cloud rather than products of their own. A
// launcher that lands you on an error page teaches people the tiles are broken.
const APPS: Record<string, readonly AppLink[]> = {
  hanzo: [
    { name: 'App', href: 'https://hanzo.app', description: 'Build with AI' },
    { name: 'Chat', href: 'https://hanzo.chat', description: 'AI chat interface' },
    { name: 'Cloud', href: 'https://cloud.hanzo.ai', description: 'Models, compute & API' },
  ],
  lux: [
    { name: 'Bridge', href: 'https://bridge.lux.network', description: 'Cross-chain bridge' },
    { name: 'Exchange', href: 'https://lux.exchange', description: 'DEX trading' },
    { name: 'Cloud', href: 'https://lux.cloud', description: 'Lux Cloud' },
    { name: 'Explorer', href: 'https://explore.lux.network', description: 'Block explorer' },
  ],
  zoo: [
    { name: 'Network', href: 'https://zoo.ngo', description: 'Zoo Labs Foundation' },
    { name: 'ZIPs', href: 'https://zips.zoo.ngo', description: 'Improvement proposals' },
    { name: 'Chat', href: 'https://chat.zoo.ngo', description: 'DeAI chat interface' },
  ],
  pars: [
    { name: 'Network', href: 'https://pars.network', description: 'Pars Network' },
    { name: 'Vote', href: 'https://pars.vote', description: 'Governance & proposals' },
  ],
}

// Billing hosts that EXIST. Measured: billing.hanzo.ai answers 200, while
// billing.lux.network, billing.zoo.network and billing.pars.network do not resolve
// at all — so naming them here put a dead link in three of the four portals, which
// is the same failure the launcher above removed for Analytics and Storage.
//
// A brand with no billing host gets no tile. It does NOT get Hanzo's: the billing
// app white-labels by hostname, so billing.hanzo.ai shown to a Lux customer is the
// Hanzo brand on a Lux surface. The tile returns for a brand the day its host does,
// and the durable fix is for the org config to carry this URL rather than a map
// compiled into the portal.
const BILLING: Record<string, string> = {
  hanzo: 'https://billing.hanzo.ai',
}

export function marketingFor(orgId: string): Marketing {
  return MARKETING[orgId] ?? MARKETING.hanzo
}

export function appsFor(orgId: string): readonly AppLink[] {
  return APPS[orgId] ?? APPS.hanzo
}

/** The brand's billing host, or undefined when it has none — then no tile. */
export function billingFor(orgId: string): string | undefined {
  return BILLING[orgId]
}
