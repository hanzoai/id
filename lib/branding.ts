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
  orgName: 'Hanzo AI',
  domain: 'hanzo.id',

  logo: '/hanzo-logo.svg',
  logoAlt: 'Hanzo AI',

  colors: {
    primary: '#ef4444',      // Red
    primaryText: '#ffffff',
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
        text: 'Hanzo AI is amazing! It\'s revolutionizing how we build and deploy applications.',
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
    socialProviders: ['google', 'github'],
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
export const staticBranding: Record<string, Partial<BrandingConfig>> = {
  'hanzo.id': {
    orgId: 'hanzo',
    orgName: 'Hanzo AI',
    logo: '/logos/hanzo.svg',
    colors: {
      primary: '#ef4444',
      primaryText: '#ffffff',
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
  },
  'lux.id': {
    orgId: 'lux',
    orgName: 'Lux Network',
    logo: '/logos/lux.svg',
    colors: {
      primary: '#f97316',      // Orange
      primaryText: '#ffffff',
      background: '#000000',
      surface: '#0a0a0a',
      text: '#ffffff',
      textMuted: '#a1a1aa',
      border: '#27272a',
      error: '#dc2626',
    },
    content: {
      title: 'Welcome to Lux',
      subtitle: 'High-performance blockchain infrastructure',
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
      title: 'Welcome to Zoo',
      subtitle: 'Open AI research network',
    },
  },
}
