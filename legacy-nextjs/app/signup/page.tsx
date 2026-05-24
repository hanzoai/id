import { Suspense } from 'react'
import { headers } from 'next/headers'
import { getBranding, staticBranding, defaultBranding, resolveBrandingDomain, BrandingConfig } from '@/lib/branding'
import SignUpForm from '@/components/SignUpForm'
import MarketingPanel from '@/components/MarketingPanel'

export const runtime = 'edge'

async function getBrandingForDomain(): Promise<BrandingConfig> {
  const headersList = await headers()
  const host = headersList.get('host') || 'hanzo.id'
  const domain = resolveBrandingDomain(host)

  const staticConfig = staticBranding[domain]
  if (staticConfig) {
    return { ...defaultBranding, ...staticConfig, domain }
  }

  return getBranding(domain)
}

export default async function SignUpPage() {
  const branding = await getBrandingForDomain()

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
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8">
        <div className="login-card w-full max-w-md p-8">
          <div className="flex items-center justify-between mb-8">
            <img
              src={branding.logo}
              alt={branding.logoAlt || branding.orgName}
              className="h-10"
            />
          </div>
          <Suspense><SignUpForm branding={branding} /></Suspense>
        </div>
      </div>

      <div className="hidden lg:flex w-1/2 items-center justify-center p-12 bg-gradient-to-br from-black via-zinc-900 to-black">
        <MarketingPanel branding={branding} />
      </div>
    </div>
  )
}
