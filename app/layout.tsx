export const runtime = 'edge'

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { staticBranding, defaultBranding, resolveBrandingDomain } from '@/lib/branding'
import './globals.css'

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers()
  const host = headersList.get('host') || 'hanzo.id'
  const domain = resolveBrandingDomain(host)

  const staticConfig = staticBranding[domain]
  const orgName = staticConfig?.orgName || defaultBranding.orgName

  return {
    title: `Sign In - ${orgName}`,
    description: `Sign in to your ${orgName} account`,
  }
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  )
}
