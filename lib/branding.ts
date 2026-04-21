/**
 * Branding configuration fetched from IAM backend based on domain
 *
 * Each organization can customize:
 * - Logo (URL or base64)
 * - Colors (primary, secondary, background, text)
 * - Login page content (quotes, testimonials)
 * - Links (terms, privacy, support)
 * - Features (which auth methods to show)
 */

export interface BrandingConfig {
  // Organization info
  orgId: string
  orgName: string
  domain: string

  // Visual branding
  logo: string
  logoAlt?: string
  favicon?: string

  // Color scheme
  colors: {
    primary: string      // Button color, accents
    primaryText: string  // Text on primary color
    background: string   // Page background
    surface: string      // Card/form background
    text: string         // Primary text
    textMuted: string    // Secondary text
    border: string       // Borders
    error: string        // Error states
  }

  // Login page content
  content: {
    title?: string           // Main heading
    subtitle?: string        // Subheading
    tagline?: string         // Marketing tagline
    quotes?: Quote[]         // Testimonials/quotes
    features?: Feature[]     // Feature highlights
  }

  // Links
  links: {
    terms?: string
    privacy?: string
    support?: string
    docs?: string
    home?: string
  }

  // Auth features
  auth: {
    passwordEnabled: boolean
    codeEnabled: boolean      // Email/SMS code
    webauthnEnabled: boolean  // Passkeys
    faceIdEnabled: boolean
    socialProviders: string[] // google, github, etc
  }
}

export interface Quote {
  text: string
  author: string
  role?: string
  company?: string
  avatar?: string
}

export interface Feature {
  title: string
  description: string
  icon?: string
}

// Default Hanzo branding (fallback)
export const defaultBranding: BrandingConfig = {
  orgId: 'hanzo',
  orgName: 'Hanzo',
  domain: 'hanzo.id',

  logo: '/logos/hanzo.svg',

  colors: {
    primary: '#e4e4e7',      // Zinc-200 (monochrome white)
    primaryText: '#09090b',  // Zinc-950 (dark text on light buttons)
    background: '#000000',   // Pure black
    surface: '#0a0a0a',      // Near black
    text: '#ffffff',
    textMuted: '#a1a1aa',
    border: '#27272a',
    error: '#dc2626',
  },

  content: {
    title: 'Start building in seconds',
    subtitle: 'Describe your idea and watch AI bring it to life instantly',
    tagline: 'AI-powered development',
    quotes: [
      {
        text: 'Hanzo is amazing! It\'s revolutionizing how we build and deploy applications.',
        author: 'Developer',
        role: 'Software Engineer',
      }
    ],
  },

  links: {
    terms: 'https://hanzo.ai/terms',
    privacy: 'https://hanzo.ai/privacy',
    support: 'https://hanzo.ai/support',
    docs: 'https://docs.hanzo.ai',
    home: 'https://hanzo.ai',
  },

  auth: {
    passwordEnabled: true,
    codeEnabled: true,
    webauthnEnabled: true,
    faceIdEnabled: true,
    socialProviders: ['metamask', 'google', 'github'],
  },
}

// Fetch branding from IAM backend based on domain
export async function getBranding(domain: string): Promise<BrandingConfig> {
  const iamUrl = process.env.HANZO_IAM_URL || 'https://api.hanzo.id'

  try {
    const res = await fetch(`${iamUrl}/api/branding?domain=${encodeURIComponent(domain)}`, {
      next: { revalidate: 300 }, // Cache for 5 minutes
    })

    if (!res.ok) {
      console.warn(`Failed to fetch branding for ${domain}, using defaults`)
      return defaultBranding
    }

    const data = await res.json()
    return { ...defaultBranding, ...data }
  } catch (error) {
    console.error(`Error fetching branding for ${domain}:`, error)
    return defaultBranding
  }
}

// Static branding configs for known domains (can be overridden by IAM)
// Supports both {org}.id format (e.g. lux.id) and id.{domain} format (e.g. id.ad.nexus)
export const staticBranding: Record<string, Partial<BrandingConfig>> = {
  'hanzo.id': {
    orgId: 'hanzo',
    orgName: 'Hanzo',
    logo: '/logos/hanzo.svg',
    colors: {
      primary: '#e4e4e7',      // Zinc-200 (monochrome white)
      primaryText: '#09090b',  // Zinc-950 (dark text on light buttons)
      background: '#000000',
      surface: '#0a0a0a',
      text: '#ffffff',
      textMuted: '#a1a1aa',
      border: '#27272a',
      error: '#dc2626',
    },
  },
  'id.hanzo.ai': {
    orgId: 'hanzo',
    orgName: 'Hanzo',
    logo: '/logos/hanzo.svg',
    colors: {
      primary: '#e4e4e7',      // Zinc-200 (monochrome white)
      primaryText: '#09090b',  // Zinc-950 (dark text on light buttons)
      background: '#000000',
      surface: '#0a0a0a',
      text: '#ffffff',
      textMuted: '#a1a1aa',
      border: '#27272a',
      error: '#dc2626',
    },
  },
  'pars.id': {
    orgId: 'pars',
    orgName: 'Pars Network',
    logo: '/logos/pars.svg',
    colors: {
      primary: '#3b82f6',      // Blue
      primaryText: '#ffffff',
      background: '#000000',
      surface: '#0a0a0a',
      text: '#ffffff',
      textMuted: '#a1a1aa',
      border: '#27272a',
      error: '#dc2626',
    },
    content: {
      title: 'Welcome to Pars',
      subtitle: 'The decentralized network for the next generation',
    },
    links: {
      terms: 'https://pars.network/terms',
      privacy: 'https://pars.network/privacy',
      support: 'https://pars.network/support',
      docs: 'https://pars.network/docs',
      home: 'https://pars.network',
    },
  },
  'id.pars.network': {
    orgId: 'pars',
    orgName: 'Pars Network',
    logo: '/logos/pars.svg',
    colors: {
      primary: '#3b82f6',      // Blue
      primaryText: '#ffffff',
      background: '#000000',
      surface: '#0a0a0a',
      text: '#ffffff',
      textMuted: '#a1a1aa',
      border: '#27272a',
      error: '#dc2626',
    },
    content: {
      title: 'Welcome to Pars',
      subtitle: 'The decentralized network for the next generation',
    },
    links: {
      terms: 'https://pars.network/terms',
      privacy: 'https://pars.network/privacy',
      support: 'https://pars.network/support',
      docs: 'https://pars.network/docs',
      home: 'https://pars.network',
    },
  },
  'lux.id': {
    orgId: 'lux',
    orgName: 'Lux Network',
    logo: '/logos/lux.svg',
    colors: {
      primary: '#e4e4e7',      // Zinc-200 (clean white)
      primaryText: '#09090b',  // Zinc-950 (dark text on light buttons)
      background: '#000000',
      surface: '#0a0a0a',
      text: '#ffffff',
      textMuted: '#a1a1aa',
      border: '#27272a',
      error: '#dc2626',
    },
    content: {
      title: 'Start deploying in seconds',
      subtitle: 'High-performance blockchain infrastructure for the Lux ecosystem',
      tagline: 'Lux-powered infrastructure',
      quotes: [
        {
          text: "Lux is fast. We deploy chains in minutes, not weeks.",
          author: 'Validator',
          role: 'Node Operator',
        }
      ],
    },
    auth: {
      passwordEnabled: true,
      codeEnabled: true,
      webauthnEnabled: true,
      faceIdEnabled: true,
      socialProviders: ['metamask', 'google', 'github'],
    },
    links: {
      terms: 'https://lux.network/terms',
      privacy: 'https://lux.network/privacy',
      support: 'https://lux.network/support',
      docs: 'https://docs.lux.network',
      home: 'https://lux.network',
    },
  },
  'id.lux.network': {
    orgId: 'lux',
    orgName: 'Lux Network',
    logo: '/logos/lux.svg',
    colors: {
      primary: '#e4e4e7',      // Zinc-200 (clean white)
      primaryText: '#09090b',  // Zinc-950 (dark text on light buttons)
      background: '#000000',
      surface: '#0a0a0a',
      text: '#ffffff',
      textMuted: '#a1a1aa',
      border: '#27272a',
      error: '#dc2626',
    },
    content: {
      title: 'Start deploying in seconds',
      subtitle: 'High-performance blockchain infrastructure for the Lux ecosystem',
      tagline: 'Lux-powered infrastructure',
      quotes: [
        {
          text: "Lux is fast. We deploy chains in minutes, not weeks.",
          author: 'Validator',
          role: 'Node Operator',
        }
      ],
    },
    auth: {
      passwordEnabled: true,
      codeEnabled: true,
      webauthnEnabled: true,
      faceIdEnabled: true,
      socialProviders: ['metamask', 'google', 'github'],
    },
    links: {
      terms: 'https://lux.network/terms',
      privacy: 'https://lux.network/privacy',
      support: 'https://lux.network/support',
      docs: 'https://docs.lux.network',
      home: 'https://lux.network',
    },
  },
  'zoo.id': {
    orgId: 'zoo',
    orgName: 'Zoo Labs',
    logo: '/logos/zoo.svg',
    colors: {
      primary: '#22c55e',      // Green
      primaryText: '#ffffff',
      background: '#000000',
      surface: '#0a0a0a',
      text: '#ffffff',
      textMuted: '#a1a1aa',
      border: '#27272a',
      error: '#dc2626',
    },
    content: {
      title: 'Build the future of DeAI',
      subtitle: 'Open AI research + decentralized science for everyone',
      tagline: 'Open AI research network',
      quotes: [
        {
          text: "Zoo is where bleeding-edge DeAI experiments actually ship.",
          author: 'Researcher',
          role: 'ML Engineer',
        }
      ],
    },
    auth: {
      passwordEnabled: true,
      codeEnabled: true,
      webauthnEnabled: true,
      faceIdEnabled: true,
      socialProviders: ['metamask', 'google', 'github'],
    },
    links: {
      terms: 'https://zoo.ngo/terms',
      privacy: 'https://zoo.ngo/privacy',
      support: 'https://zoo.ngo/support',
      docs: 'https://zoo.ngo/docs',
      home: 'https://zoo.ngo',
    },
  },
  'id.zoo.network': {
    orgId: 'zoo',
    orgName: 'Zoo Labs',
    logo: '/logos/zoo.svg',
    colors: {
      primary: '#22c55e',      // Green
      primaryText: '#ffffff',
      background: '#000000',
      surface: '#0a0a0a',
      text: '#ffffff',
      textMuted: '#a1a1aa',
      border: '#27272a',
      error: '#dc2626',
    },
    content: {
      title: 'Build the future of DeAI',
      subtitle: 'Open AI research + decentralized science for everyone',
      tagline: 'Open AI research network',
      quotes: [
        {
          text: "Zoo is where bleeding-edge DeAI experiments actually ship.",
          author: 'Researcher',
          role: 'ML Engineer',
        }
      ],
    },
    auth: {
      passwordEnabled: true,
      codeEnabled: true,
      webauthnEnabled: true,
      faceIdEnabled: true,
      socialProviders: ['metamask', 'google', 'github'],
    },
    links: {
      terms: 'https://zoo.ngo/terms',
      privacy: 'https://zoo.ngo/privacy',
      support: 'https://zoo.ngo/support',
      docs: 'https://zoo.ngo/docs',
      home: 'https://zoo.ngo',
    },
  },
  'zen.id': {
    orgId: 'zen',
    orgName: 'Zen LM',
    logo: '/logos/zen.svg',
    colors: {
      primary: '#a855f7',      // Purple (Zen violet)
      primaryText: '#ffffff',
      background: '#000000',
      surface: '#0a0a0a',
      text: '#ffffff',
      textMuted: '#a1a1aa',
      border: '#27272a',
      error: '#dc2626',
    },
    content: {
      title: 'Welcome to Zen',
      subtitle: 'Frontier AI models for everyone',
    },
    links: {
      terms: 'https://zenlm.org/terms',
      privacy: 'https://zenlm.org/privacy',
      support: 'https://zenlm.org/support',
      docs: 'https://zenlm.org/docs',
      home: 'https://zenlm.org',
    },
  },
  'id.ad.nexus': {
    orgId: 'adnexus',
    orgName: 'Ad Nexus',
    logo: '/logos/adnexus.svg',
    logoAlt: 'Ad Nexus',
    colors: {
      primary: '#8b5cf6',      // Purple
      primaryText: '#ffffff',
      background: '#000000',
      surface: '#0a0a0a',
      text: '#ffffff',
      textMuted: '#a1a1aa',
      border: '#27272a',
      error: '#dc2626',
    },
    content: {
      title: 'Welcome to Ad Nexus',
      subtitle: 'Programmatic advertising platform',
    },
    links: {
      terms: 'https://ad.nexus/terms',
      privacy: 'https://ad.nexus/privacy',
      support: 'https://ad.nexus/support',
      home: 'https://ad.nexus',
    },
  },
  'ad.nexus': {
    orgId: 'adnexus',
    orgName: 'Ad Nexus',
    logo: '/logos/adnexus.svg',
    logoAlt: 'Ad Nexus',
    colors: {
      primary: '#8b5cf6',      // Purple
      primaryText: '#ffffff',
      background: '#000000',
      surface: '#0a0a0a',
      text: '#ffffff',
      textMuted: '#a1a1aa',
      border: '#27272a',
      error: '#dc2626',
    },
    content: {
      title: 'Welcome to Ad Nexus',
      subtitle: 'Programmatic advertising platform',
    },
    links: {
      terms: 'https://ad.nexus/terms',
      privacy: 'https://ad.nexus/privacy',
      support: 'https://ad.nexus/support',
      home: 'https://ad.nexus',
    },
  },
}

// Resolve domain to branding key
// Handles: exact match, id.{domain} → {domain}, {sub}.{domain} patterns
export function resolveBrandingDomain(host: string): string {
  const domain = host.split(':')[0]

  // Exact match first
  if (staticBranding[domain]) return domain

  // Try stripping 'id.' prefix: id.ad.nexus → ad.nexus
  if (domain.startsWith('id.')) {
    const stripped = domain.slice(3)
    if (staticBranding[stripped]) return stripped
  }

  return domain
}
