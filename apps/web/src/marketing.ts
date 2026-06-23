/**
 * Per-org marketing content + app launcher links.
 *
 * The brand-neutral `BrandContract` (from `loadBrand`) carries only the
 * visual essentials (name, logo, accent). The split-view login's marketing
 * panel and the post-login apps launcher need richer, org-specific copy —
 * ported verbatim from the frozen `legacy-nextjs` design (`staticBranding`
 * content + `orgApps`). Keyed by `tenant.orgId` so it stays decoupled from
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

const APPS: Record<string, readonly AppLink[]> = {
  hanzo: [
    { name: 'Console', href: 'https://console.hanzo.ai', description: 'Observability & traces' },
    { name: 'Chat', href: 'https://hanzo.chat', description: 'AI chat interface' },
    { name: 'Cloud', href: 'https://cloud.hanzo.ai', description: 'AI model API' },
    { name: 'Analytics', href: 'https://analytics.hanzo.ai', description: 'Web analytics' },
    { name: 'Platform', href: 'https://platform.hanzo.ai', description: 'PaaS deployments' },
    { name: 'Storage', href: 'https://s3.hanzo.ai', description: 'S3-compatible storage' },
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

const BILLING: Record<string, string> = {
  hanzo: 'https://billing.hanzo.ai',
  lux: 'https://billing.lux.network',
  zoo: 'https://billing.zoo.network',
  pars: 'https://billing.pars.network',
}

export function marketingFor(orgId: string): Marketing {
  return MARKETING[orgId] ?? MARKETING.hanzo
}

export function appsFor(orgId: string): readonly AppLink[] {
  return APPS[orgId] ?? APPS.hanzo
}

export function billingFor(orgId: string): string {
  return BILLING[orgId] ?? BILLING.hanzo
}
