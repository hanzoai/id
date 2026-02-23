import { headers } from 'next/headers'
import { getBranding, staticBranding, defaultBranding, resolveBrandingDomain, BrandingConfig } from '@/lib/branding'
import LoginForm from '@/components/LoginForm'
import MarketingPanel from '@/components/MarketingPanel'

async function getBrandingForDomain(): Promise<BrandingConfig> {
  const headersList = await headers()
  const host = headersList.get('host') || 'hanzo.id'
  const domain = resolveBrandingDomain(host)

  // First check static configs, then fetch from IAM
  const staticConfig = staticBranding[domain]
  if (staticConfig) {
    return { ...defaultBranding, ...staticConfig, domain }
  }

  return getBranding(domain)
}

export default async function LoginPage() {
  const branding = await getBrandingForDomain()

  // Generate CSS variables from branding
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
    <div className="min-h-screen flex" style={cssVars}>
      {/* Left side - Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8">
        <div className="login-card w-full max-w-md p-8">
          {/* Logo */}
          <div className="flex items-center justify-between mb-8">
            <img
              src={branding.logo}
              alt={branding.logoAlt || branding.orgName}
              className="h-10"
            />
            <button className="p-2 rounded-lg hover:bg-white/5">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
              </svg>
            </button>
          </div>

          <LoginForm branding={branding} />
        </div>
      </div>

      {/* Right side - Marketing Panel */}
      <div className="hidden lg:flex w-1/2 items-center justify-center p-12 bg-gradient-to-br from-black via-zinc-900 to-black">
        <MarketingPanel branding={branding} />
      </div>
    </div>
  )
}
