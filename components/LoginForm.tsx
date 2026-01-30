'use client'

import { useState } from 'react'
import type { BrandingConfig } from '@/lib/branding'

interface LoginFormProps {
  branding: BrandingConfig
}

type AuthMethod = 'password' | 'code' | 'webauthn' | 'faceid'

export default function LoginForm({ branding }: LoginFormProps) {
  const [authMethod, setAuthMethod] = useState<AuthMethod>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [autoSignIn, setAutoSignIn] = useState(true)
  const [isLoading, setIsLoading] = useState(false)

  const iamUrl = process.env.NEXT_PUBLIC_IAM_URL || 'https://api.hanzo.id'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      // Redirect to IAM OAuth flow
      const params = new URLSearchParams({
        client_id: branding.orgId,
        redirect_uri: window.location.origin + '/callback',
        response_type: 'code',
        scope: 'openid email profile',
        state: crypto.randomUUID(),
      })

      window.location.href = `${iamUrl}/oauth/authorize?${params}`
    } catch (error) {
      console.error('Login error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const authTabs = [
    { key: 'password' as const, label: 'Password', enabled: branding.auth.passwordEnabled },
    { key: 'code' as const, label: 'Code', enabled: branding.auth.codeEnabled },
    { key: 'webauthn' as const, label: 'WebAuthn', enabled: branding.auth.webauthnEnabled },
    { key: 'faceid' as const, label: 'Face ID', enabled: branding.auth.faceIdEnabled },
  ].filter(t => t.enabled)

  return (
    <div>
      {/* Auth method tabs */}
      {authTabs.length > 1 && (
        <div className="flex gap-4 mb-6 border-b border-zinc-800">
          {authTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setAuthMethod(tab.key)}
              className={`pb-3 text-sm font-medium transition-colors ${
                authMethod === tab.key
                  ? 'text-white border-b-2'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
              style={{
                borderColor: authMethod === tab.key ? branding.colors.primary : 'transparent'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Email/Username */}
        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <input
            type="text"
            placeholder="username, Email or phone"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input w-full pl-10 pr-10 py-3 rounded-lg"
          />
          <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2">
            <span className="px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded">中文</span>
          </button>
        </div>

        {/* Password (only for password auth) */}
        {authMethod === 'password' && (
          <div className="relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input w-full pl-10 pr-20 py-3 rounded-lg"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-1">
              <button type="button" className="px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded">
                中文
              </button>
              <button type="button" className="p-1 text-zinc-500 hover:text-zinc-300">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Auto sign in & Forgot password */}
        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoSignIn}
              onChange={(e) => setAutoSignIn(e.target.checked)}
              className="w-4 h-4 rounded"
              style={{ accentColor: branding.colors.primary }}
            />
            <span className="text-zinc-400">Auto sign in</span>
          </label>
          <a
            href="/forgot-password"
            className="link text-sm"
            style={{ color: branding.colors.primary }}
          >
            Forgot password?
          </a>
        </div>

        {/* Sign in button */}
        <button
          type="submit"
          disabled={isLoading}
          className="btn-primary w-full py-3 rounded-lg font-medium"
          style={{ backgroundColor: branding.colors.primary }}
        >
          {isLoading ? 'Signing in...' : 'Sign In'}
        </button>

        {/* Sign up link */}
        <p className="text-center text-sm text-zinc-500">
          No account?{' '}
          <a
            href="/signup"
            className="link"
            style={{ color: branding.colors.primary }}
          >
            sign up now
          </a>
        </p>

        {/* Social providers */}
        {branding.auth.socialProviders.length > 0 && (
          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-zinc-800" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-zinc-900 text-zinc-500">Or continue with</span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              {branding.auth.socialProviders.includes('google') && (
                <button
                  type="button"
                  className="flex items-center justify-center gap-2 py-2 px-4 border border-zinc-700 rounded-lg hover:bg-zinc-800 transition-colors"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Google
                </button>
              )}
              {branding.auth.socialProviders.includes('github') && (
                <button
                  type="button"
                  className="flex items-center justify-center gap-2 py-2 px-4 border border-zinc-700 rounded-lg hover:bg-zinc-800 transition-colors"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                  GitHub
                </button>
              )}
            </div>
          </div>
        )}
      </form>

      {/* Footer links */}
      <div className="mt-8 pt-6 border-t border-zinc-800 flex justify-center gap-4 text-xs text-zinc-500">
        {branding.links.terms && (
          <a href={branding.links.terms} className="hover:text-zinc-300">Terms</a>
        )}
        {branding.links.privacy && (
          <a href={branding.links.privacy} className="hover:text-zinc-300">Privacy</a>
        )}
        {branding.links.support && (
          <a href={branding.links.support} className="hover:text-zinc-300">Support</a>
        )}
      </div>
    </div>
  )
}
