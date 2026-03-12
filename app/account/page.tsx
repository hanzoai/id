'use client'

export const runtime = 'edge'

import { useEffect, useState } from 'react'
import { fetchUserInfo } from '@/lib/oauth'
import { getIamUrl, getOrg } from '@/lib/iam'
import { staticBranding, defaultBranding, resolveBrandingDomain, type BrandingConfig } from '@/lib/branding'

interface User {
  sub: string
  name?: string
  displayName?: string
  email?: string
  avatar?: string
}

// Per-org app links
const orgApps: Record<string, { name: string; href: string; description: string }[]> = {
  hanzo: [
    { name: 'Console', href: 'https://console.hanzo.ai', description: 'Observability & traces' },
    { name: 'Chat', href: 'https://hanzo.chat', description: 'AI chat interface' },
    { name: 'Cloud', href: 'https://cloud.hanzo.ai', description: 'AI model API' },
    { name: 'Analytics', href: 'https://analytics.hanzo.ai', description: 'Web analytics' },
    { name: 'Platform', href: 'https://platform.hanzo.ai', description: 'PaaS deployments' },
    { name: 'Storage', href: 'https://hanzo.space', description: 'S3-compatible storage' },
  ],
  lux: [
    { name: 'Bridge', href: 'https://bridge.lux.network', description: 'Cross-chain bridge' },
    { name: 'Exchange', href: 'https://lux.exchange', description: 'DEX trading' },
    { name: 'Cloud', href: 'https://cloud.lux.network', description: 'Lux Cloud' },
    { name: 'Explorer', href: 'https://explore.lux.network', description: 'Block explorer' },
  ],
  zoo: [
    { name: 'Network', href: 'https://zoo.ngo', description: 'Zoo Labs Foundation' },
    { name: 'ZIPs', href: 'https://zips.zoo.ngo', description: 'Improvement proposals' },
  ],
  pars: [
    { name: 'Network', href: 'https://pars.network', description: 'Pars Network' },
    { name: 'Foundation', href: 'https://parsis.foundation', description: 'Parsis Foundation' },
  ],
}

// Per-org billing URL
function getBillingUrl(org: string): string {
  switch (org) {
    case 'lux': return 'https://billing.lux.network'
    case 'zoo': return 'https://billing.zoo.network'
    case 'pars': return 'https://billing.pars.network'
    default: return 'https://billing.hanzo.ai'
  }
}

export default function AccountPage() {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const host = typeof window !== 'undefined' ? window.location.hostname : 'hanzo.id'
  const domain = resolveBrandingDomain(host)
  const staticConfig = staticBranding[domain]
  const branding: BrandingConfig = staticConfig
    ? { ...defaultBranding, ...staticConfig, domain }
    : { ...defaultBranding, domain }

  const org = getOrg(host)
  const apps = orgApps[org] || orgApps.hanzo
  const billingUrl = getBillingUrl(org)

  useEffect(() => {
    loadUser()
  }, [])

  async function loadUser() {
    const token = localStorage.getItem('hanzo_access_token')
    if (!token) {
      window.location.href = '/login'
      return
    }

    // Try cached user first
    try {
      const cached = localStorage.getItem('hanzo_user')
      if (cached) {
        setUser(JSON.parse(cached))
        setIsLoading(false)
      }
    } catch {}

    // Fetch fresh user info — use same-origin proxy to avoid CORS
    try {
      const userinfoUrl = window.location.origin + '/oauth/userinfo'
      const info = await fetchUserInfo(userinfoUrl.replace('/oauth/userinfo', ''), token)
      const userData: User = {
        sub: info.sub,
        name: info.name,
        displayName: info.displayName,
        email: info.email,
        avatar: info.avatar || info.permanentAvatar,
      }
      // Also try decoding id_token for richer claims
      if ((!userData.email || !userData.displayName) && localStorage.getItem('hanzo_id_token')) {
        try {
          const idToken = localStorage.getItem('hanzo_id_token')!
          const p = JSON.parse(atob(idToken.split('.')[1]))
          userData.email = userData.email || p.email
          userData.displayName = userData.displayName || p.displayName || p.name || p.preferred_username
          userData.name = userData.name || p.name || p.preferred_username
          userData.avatar = userData.avatar || p.avatar || p.picture || p.permanentAvatar
        } catch {}
      }
      setUser(userData)
      localStorage.setItem('hanzo_user', JSON.stringify(userData))
    } catch {
      // Token expired or invalid
      localStorage.removeItem('hanzo_access_token')
      localStorage.removeItem('hanzo_user')
      window.location.href = '/login'
      return
    } finally {
      setIsLoading(false)
    }
  }

  function handleLogout() {
    localStorage.removeItem('hanzo_access_token')
    localStorage.removeItem('hanzo_refresh_token')
    localStorage.removeItem('hanzo_user')
    window.location.href = '/login'
  }

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

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div
          className="animate-spin w-8 h-8 border-2 border-zinc-700 rounded-full"
          style={{ borderTopColor: branding.colors.primary }}
        />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black" style={cssVars}>
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 md:px-12 py-4 border-b border-zinc-800/50">
        <a href="/" className="flex items-center gap-3">
          <img src={branding.logo} alt={branding.orgName} className="h-8" />
        </a>
        <div className="flex items-center gap-4">
          <a
            href={billingUrl}
            className="text-sm text-zinc-400 hover:text-white transition-colors"
          >
            Billing
          </a>
          <button
            onClick={handleLogout}
            className="text-sm text-zinc-400 hover:text-white transition-colors"
          >
            Sign out
          </button>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 md:px-12 py-12">
        {/* Profile header */}
        <div className="flex items-center gap-6 mb-12">
          {user?.avatar ? (
            <img src={user.avatar} alt="" className="w-20 h-20 rounded-full" />
          ) : (
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold"
              style={{ backgroundColor: branding.colors.primary + '20', color: branding.colors.primary }}
            >
              {(user?.displayName || user?.name || user?.email || '?')[0].toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-3xl font-bold text-white">
              {user?.displayName || user?.name || 'User'}
            </h1>
            {user?.email && (
              <p className="text-zinc-400 mt-1">{user.email}</p>
            )}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Account info */}
          <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/30">
            <h2 className="text-lg font-semibold text-white mb-4">Account</h2>
            <div className="space-y-4">
              <div>
                <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">User ID</div>
                <div className="text-white font-mono text-sm">{user?.sub}</div>
              </div>
              {user?.name && (
                <div>
                  <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Username</div>
                  <div className="text-white">{user.name}</div>
                </div>
              )}
              {user?.email && (
                <div>
                  <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Email</div>
                  <div className="text-white">{user.email}</div>
                </div>
              )}
              <div>
                <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Organization</div>
                <div className="text-white">{branding.orgName}</div>
              </div>
            </div>
          </div>

          {/* Billing */}
          <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/30">
            <h2 className="text-lg font-semibold text-white mb-4">Billing & Usage</h2>
            <p className="text-zinc-400 text-sm mb-6">
              Manage your subscription, payment methods, and usage.
            </p>
            <a
              href={billingUrl}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-opacity hover:opacity-90"
              style={{ backgroundColor: branding.colors.primary, color: branding.colors.primaryText }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
              Manage Billing
            </a>
          </div>
        </div>

        {/* Apps */}
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-white mb-4">{branding.orgName} Apps</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {apps.map((app) => (
              <a
                key={app.name}
                href={app.href}
                className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/30 hover:bg-zinc-900/60 transition-colors group"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-white">{app.name}</span>
                  <svg className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </div>
                <p className="text-sm text-zinc-500">{app.description}</p>
              </a>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="mt-12 pt-8 border-t border-zinc-800 flex items-center justify-between">
          <a
            href="/"
            className="text-sm text-zinc-500 hover:text-white transition-colors"
          >
            &larr; Back to {branding.orgName}
          </a>
          <button
            onClick={handleLogout}
            className="px-4 py-2 rounded-lg border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors text-sm"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
