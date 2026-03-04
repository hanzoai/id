import { headers } from 'next/headers'
import Link from 'next/link'
import { staticBranding, defaultBranding, resolveBrandingDomain, type BrandingConfig } from '@/lib/branding'

export const runtime = 'edge'

// Per-org landing page content
interface LandingContent {
  headline: string
  description: string
  features: { title: string; description: string; icon: string }[]
  standards: { label: string; value: string }[]
  cta: string
  secondaryCta?: { label: string; href: string }
}

const landingContent: Record<string, LandingContent> = {
  lux: {
    headline: 'Your Identity on Lux',
    description: 'Decentralized identity anchored on high-performance blockchain infrastructure. Own your credentials, prove who you are without exposing what you are, and authenticate across the entire Lux ecosystem with one login.',
    features: [
      {
        title: 'Decentralized Identifiers (DIDs)',
        description: 'W3C-standard DIDs anchored on Lux Network. Your identity is portable, censorship-resistant, and fully under your control. No central authority can revoke or freeze your credentials.',
        icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
      },
      {
        title: 'Verifiable Credentials',
        description: 'Issue and present tamper-proof credentials — KYC attestations, membership proofs, reputation scores — without revealing unnecessary personal data. Selective disclosure by default.',
        icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
      },
      {
        title: 'Cross-Chain Single Sign-On',
        description: 'One identity across Lux mainnet, subnets, the bridge, DEX, and every ecosystem dApp. OAuth2/OIDC compliant — works with traditional apps too.',
        icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
      },
      {
        title: 'Post-Quantum Cryptography',
        description: 'Forward-looking key management with lattice-based and hash-based signatures. Your identity stays secure against quantum computing threats — today and tomorrow.',
        icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
      },
      {
        title: 'Key Recovery & Social Recovery',
        description: 'Lost your keys? Recover your identity through trusted guardians, multi-sig recovery, or hardware backup — no single point of failure.',
        icon: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z',
      },
      {
        title: 'Privacy-Preserving Auth',
        description: 'Zero-knowledge proofs let you prove eligibility, age, membership, or accreditation without revealing the underlying data. Your privacy is non-negotiable.',
        icon: 'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
      },
    ],
    standards: [
      { label: 'W3C DID', value: 'Core v1.0' },
      { label: 'OAuth 2.0', value: 'RFC 6749' },
      { label: 'OIDC', value: 'Core 1.0' },
      { label: 'PKCE', value: 'RFC 7636' },
      { label: 'WebAuthn', value: 'L2' },
      { label: 'FIDO2', value: 'Passkeys' },
    ],
    cta: 'Create Your Lux ID',
    secondaryCta: { label: 'Explore Lux Network', href: 'https://lux.network' },
  },
  pars: {
    headline: 'Your Identity on Pars',
    description: 'Self-sovereign identity for the next generation of decentralized infrastructure. Own your data, control your credentials, and authenticate across the Pars ecosystem with confidence.',
    features: [
      {
        title: 'Self-Sovereign Identity',
        description: 'Your identity belongs to you — not a corporation, not a government. W3C DID-compliant identifiers give you full ownership and portability.',
        icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
      },
      {
        title: 'Verifiable Credentials',
        description: 'Carry tamper-proof digital credentials — academic degrees, professional certifications, KYC attestations — verified on-chain, shared on your terms.',
        icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
      },
      {
        title: 'Ecosystem-Wide Access',
        description: 'One account for all Pars applications, governance, staking, and partner integrations. Standards-based SSO that just works.',
        icon: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9',
      },
      {
        title: 'Privacy by Design',
        description: 'Zero-knowledge proofs and selective disclosure — share only what you choose. Prove you\'re eligible without revealing why.',
        icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
      },
      {
        title: 'Multi-Factor Security',
        description: 'Hardware keys, biometrics, TOTP, passkeys — layer security however you need. Enterprise-grade protection for every user.',
        icon: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z',
      },
      {
        title: 'Open Standards',
        description: 'Built on OAuth 2.0, OpenID Connect, W3C DIDs, and Verifiable Credentials. No vendor lock-in, interoperable with any standards-compliant system.',
        icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
      },
    ],
    standards: [
      { label: 'W3C DID', value: 'Core v1.0' },
      { label: 'OAuth 2.0', value: 'RFC 6749' },
      { label: 'OIDC', value: 'Core 1.0' },
      { label: 'PKCE', value: 'RFC 7636' },
      { label: 'WebAuthn', value: 'L2' },
      { label: 'VC', value: 'Data Model' },
    ],
    cta: 'Create Your Pars ID',
    secondaryCta: { label: 'Explore Pars Network', href: 'https://pars.network' },
  },
  zoo: {
    headline: 'Your Identity on Zoo',
    description: 'Verifiable research identity for the open AI research network. Collaborate on decentralized science, participate in governance, and build reputation across the Zoo ecosystem.',
    features: [
      {
        title: 'Research Identity',
        description: 'A verifiable, portable identity for researchers, contributors, and AI practitioners. Link your publications, models, and contributions to a cryptographic identity you own.',
        icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
      },
      {
        title: 'Governance & ZIPs',
        description: 'Participate in Zoo Improvement Proposals (ZIPs) with a verified identity. Vote on protocol upgrades, fund allocation, and research priorities.',
        icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10',
      },
      {
        title: 'Cross-Network Reputation',
        description: 'Build reputation that travels with you. Contributions to Zoo, Hanzo, and partner networks all feed into a unified, verifiable reputation graph.',
        icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
      },
      {
        title: 'Decentralized Science (DeSci)',
        description: 'Credential your research contributions on-chain. Peer review, data sharing, and reproducibility — all backed by verifiable credentials.',
        icon: 'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z',
      },
      {
        title: 'Privacy-First',
        description: 'Selective disclosure lets you prove qualifications without exposing personal data. Research anonymously when you need to.',
        icon: 'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
      },
      {
        title: 'Open & Interoperable',
        description: 'W3C DID, OAuth 2.0, OIDC — standards-based identity that works with ORCID, institutional logins, and any research platform.',
        icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
      },
    ],
    standards: [
      { label: 'W3C DID', value: 'Core v1.0' },
      { label: 'OAuth 2.0', value: 'RFC 6749' },
      { label: 'OIDC', value: 'Core 1.0' },
      { label: 'PKCE', value: 'RFC 7636' },
      { label: 'VC', value: 'Data Model' },
      { label: 'DeSci', value: 'ZIPs' },
    ],
    cta: 'Create Your Zoo ID',
    secondaryCta: { label: 'Explore Zoo Network', href: 'https://zoo.ngo' },
  },
  hanzo: {
    headline: 'Your AI Identity',
    description: 'One identity across the entire Hanzo AI ecosystem. Secure, standards-based authentication for developers building the future of AI.',
    features: [
      {
        title: 'Unified AI Access',
        description: 'Single sign-in to Console, Chat, Cloud, Gateway, and every Hanzo service. One identity, one API key namespace, one billing account.',
        icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
      },
      {
        title: 'Developer-First Auth',
        description: 'OAuth 2.0, OpenID Connect, PKCE, API keys, service tokens — all RFC-standard. SDKs in Python, TypeScript, Go, and Rust. No vendor lock-in.',
        icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
      },
      {
        title: 'Enterprise Security',
        description: 'SSO with SAML/OIDC, hardware-backed MFA, fine-grained RBAC, audit logs, and SOC 2 compliance. Built for teams that ship.',
        icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
      },
      {
        title: 'Multi-Tenant Organizations',
        description: 'Create organizations, invite team members, assign roles, and scope API keys — all from a single identity. White-label ready for your own domains.',
        icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
      },
      {
        title: 'Passkeys & Biometrics',
        description: 'FIDO2 passkeys, Face ID, Touch ID, hardware security keys — passwordless authentication that\'s both more secure and more convenient.',
        icon: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z',
      },
      {
        title: 'Web3 + Traditional',
        description: 'Connect with MetaMask, WalletConnect, or hardware wallets alongside traditional email/password and social login. Bridge Web2 and Web3 seamlessly.',
        icon: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9',
      },
    ],
    standards: [
      { label: 'OAuth 2.0', value: 'RFC 6749' },
      { label: 'OIDC', value: 'Core 1.0' },
      { label: 'PKCE', value: 'RFC 7636' },
      { label: 'WebAuthn', value: 'L2' },
      { label: 'SAML', value: '2.0' },
      { label: 'FIDO2', value: 'Passkeys' },
    ],
    cta: 'Get Started',
    secondaryCta: { label: 'Read the Docs', href: 'https://docs.hanzo.ai' },
  },
  zen: {
    headline: 'Your Zen Identity',
    description: 'Access frontier AI models with a single identity. Zen LM powers the next generation of language models — your identity unlocks them all.',
    features: [
      {
        title: 'Model Access',
        description: 'Authenticate once to access all Zen LM models — from 600M to 480B parameters. Inference, fine-tuning, and evaluation with one API key.',
        icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
      },
      {
        title: 'Usage & Billing',
        description: 'Track model usage, manage API keys, set spending limits, and control team access — all from your Zen ID dashboard.',
        icon: 'M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z',
      },
      {
        title: 'Open Standards',
        description: 'OAuth 2.0 / OIDC compliant — integrate with any platform, CI/CD pipeline, or workflow. SDKs for every major language.',
        icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
      },
      {
        title: 'Developer Experience',
        description: 'CLI login, API key management, scoped tokens, and seamless integration with development tools. Built for AI engineers.',
        icon: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
      },
      {
        title: 'Team Management',
        description: 'Create organizations, invite collaborators, and share model access with fine-grained permissions.',
        icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
      },
      {
        title: 'Cross-Ecosystem',
        description: 'Your Zen ID works across Hanzo, Lux, Zoo, and partner platforms. One identity, every AI service.',
        icon: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9',
      },
    ],
    standards: [
      { label: 'OAuth 2.0', value: 'RFC 6749' },
      { label: 'OIDC', value: 'Core 1.0' },
      { label: 'PKCE', value: 'RFC 7636' },
      { label: 'WebAuthn', value: 'L2' },
      { label: 'FIDO2', value: 'Passkeys' },
      { label: 'JWT', value: 'RFC 7519' },
    ],
    cta: 'Get Started with Zen',
    secondaryCta: { label: 'Explore Models', href: 'https://zenlm.org' },
  },
  adnexus: {
    headline: 'Your Ad Nexus Identity',
    description: 'Secure identity for the programmatic advertising platform. Manage campaigns, analytics, and integrations with enterprise-grade authentication.',
    features: [
      {
        title: 'Campaign Access',
        description: 'Single sign-on to all Ad Nexus tools — campaign manager, analytics dashboard, creative studio, and billing.',
        icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
      },
      {
        title: 'Team Permissions',
        description: 'Role-based access control for agencies and brands. Scoped permissions for campaign managers, analysts, and billing admins.',
        icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
      },
      {
        title: 'Enterprise SSO',
        description: 'SAML, OIDC, and OAuth 2.0 federation. Connect your existing identity provider for seamless onboarding.',
        icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
      },
    ],
    standards: [
      { label: 'OAuth 2.0', value: 'RFC 6749' },
      { label: 'OIDC', value: 'Core 1.0' },
      { label: 'SAML', value: '2.0' },
      { label: 'PKCE', value: 'RFC 7636' },
    ],
    cta: 'Get Started',
    secondaryCta: { label: 'Learn More', href: 'https://ad.nexus' },
  },
}

const defaultLanding = landingContent.hanzo

async function getBrandingForDomain() {
  const headersList = await headers()
  const host = headersList.get('host') || 'hanzo.id'
  const domain = resolveBrandingDomain(host)
  const staticConfig = staticBranding[domain]
  const branding: BrandingConfig = staticConfig
    ? { ...defaultBranding, ...staticConfig, domain }
    : { ...defaultBranding, domain }
  return branding
}

export default async function Home() {
  const branding = await getBrandingForDomain()
  const content = landingContent[branding.orgId] || defaultLanding

  const cssVars = {
    '--color-primary': branding.colors.primary,
    '--color-primary-text': branding.colors.primaryText,
    '--color-background': branding.colors.background,
    '--color-surface': branding.colors.surface,
    '--color-text': branding.colors.text,
    '--color-text-muted': branding.colors.textMuted,
    '--color-border': branding.colors.border,
    '--color-error': branding.colors.error,
  } as React.CSSProperties

  return (
    <div className="min-h-screen flex flex-col" style={cssVars}>
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 md:px-12 py-4 border-b border-zinc-800/50">
        <div className="flex items-center gap-3">
          <img src={branding.logo} alt={branding.orgName} className="h-8" />
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm text-zinc-400 hover:text-white transition-colors">
            Sign In
          </Link>
          <Link
            href="/signup"
            className="text-sm px-4 py-2 rounded-lg font-medium transition-opacity hover:opacity-90"
            style={{ backgroundColor: branding.colors.primary, color: branding.colors.primaryText }}
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 md:px-12 py-20 md:py-32">
        <div className="max-w-4xl mx-auto text-center">
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm mb-8"
            style={{ borderColor: branding.colors.primary + '40', color: branding.colors.primary }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            Decentralized Identity
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-white mb-6 leading-tight tracking-tight">
            {content.headline}
          </h1>
          <p className="text-lg md:text-xl text-zinc-400 max-w-2xl mx-auto mb-12 leading-relaxed">
            {content.description}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
            <Link
              href="/signup"
              className="px-8 py-3.5 rounded-lg font-medium text-lg transition-opacity hover:opacity-90 w-full sm:w-auto"
              style={{ backgroundColor: branding.colors.primary, color: branding.colors.primaryText }}
            >
              {content.cta}
            </Link>
            {content.secondaryCta ? (
              <a
                href={content.secondaryCta.href}
                className="px-8 py-3.5 rounded-lg font-medium text-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors w-full sm:w-auto text-center"
              >
                {content.secondaryCta.label}
              </a>
            ) : (
              <Link
                href="/login"
                className="px-8 py-3.5 rounded-lg font-medium text-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors w-full sm:w-auto text-center"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Standards bar */}
      <section className="border-y border-zinc-800/50 px-6 md:px-12 py-6">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-center gap-6 md:gap-10">
          {content.standards.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="text-zinc-500">{s.label}</span>
              <span className="text-zinc-300 font-mono text-xs px-1.5 py-0.5 rounded bg-zinc-800">{s.value}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="px-6 md:px-12 py-20 md:py-28">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Built for the future of identity
            </h2>
            <p className="text-zinc-400 max-w-2xl mx-auto">
              Standards-compliant, privacy-preserving, and designed for decentralized ecosystems.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {content.features.map((feature, i) => (
              <div key={i} className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/30 hover:bg-zinc-900/60 transition-colors">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center mb-4"
                  style={{ backgroundColor: branding.colors.primary + '15' }}
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    style={{ color: branding.colors.primary }}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={feature.icon} />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 md:px-12 py-20">
        <div className="max-w-4xl mx-auto text-center">
          <div className="p-12 rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-900/30">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Ready to own your identity?
            </h2>
            <p className="text-zinc-400 mb-8 max-w-lg mx-auto">
              Create your {branding.orgName} ID in seconds. Free, open, and yours forever.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/signup"
                className="px-8 py-3.5 rounded-lg font-medium text-lg transition-opacity hover:opacity-90"
                style={{ backgroundColor: branding.colors.primary, color: branding.colors.primaryText }}
              >
                {content.cta}
              </Link>
              <Link
                href="/login"
                className="text-zinc-400 hover:text-white transition-colors"
              >
                Already have an account? Sign in
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-800/50 px-6 md:px-12 py-8">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-zinc-500">
          <div className="flex items-center gap-3">
            <img src={branding.logo} alt={branding.orgName} className="h-5 opacity-50" />
            <span>&copy; {new Date().getFullYear()} {branding.orgName}</span>
          </div>
          <div className="flex gap-6">
            {branding.links.terms && <a href={branding.links.terms} className="hover:text-zinc-300 transition-colors">Terms</a>}
            {branding.links.privacy && <a href={branding.links.privacy} className="hover:text-zinc-300 transition-colors">Privacy</a>}
            {branding.links.docs && <a href={branding.links.docs} className="hover:text-zinc-300 transition-colors">Documentation</a>}
            {branding.links.home && <a href={branding.links.home} className="hover:text-zinc-300 transition-colors">{branding.orgName}</a>}
          </div>
        </div>
      </footer>
    </div>
  )
}
