'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import type { BrandingConfig } from '@/lib/branding'
import { passwordLogin, startAuthorize } from '@/lib/oauth'
import { getIamUrl, getOrg, getDefaultClientId } from '@/lib/iam'

interface LoginFormProps {
  branding: BrandingConfig
}

type AuthMethod = 'password' | 'code' | 'webauthn' | 'faceid'

export default function LoginForm({ branding }: LoginFormProps) {
  const searchParams = useSearchParams()
  const [authMethod, setAuthMethod] = useState<AuthMethod>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [autoSignIn, setAutoSignIn] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const host = typeof window !== 'undefined' ? window.location.hostname : 'hanzo.id'
  const iamUrl = getIamUrl(host)
  const org = getOrg(host)
  const defaultClientId = getDefaultClientId(host)

  // OAuth params from query string (when redirected from a client app)
  const clientId = searchParams.get('client_id') ?? searchParams.get('clientId') ?? defaultClientId
  const redirectUri = searchParams.get('redirect_uri') ?? searchParams.get('redirectUri')
  const responseType = searchParams.get('response_type') ?? searchParams.get('responseType')
  const scope = searchParams.get('scope')
  const state = searchParams.get('state')
  const codeChallenge = searchParams.get('code_challenge')
  const codeChallengeMethod = searchParams.get('code_challenge_method')

  const isOAuthFlow = !!(redirectUri && responseType)

  // Resolve the IAM application name from clientId.
  // IAM's /api/login expects the application NAME (e.g. "app-hanzobot"),
  // not the OAuth client_id (e.g. "hanzobot-client-id").
  const [appName, setAppName] = useState<string | null>(null)

  useEffect(() => {
    if (!clientId) return

    const params = new URLSearchParams({
      clientId,
      type: 'code',
      responseType: responseType || 'code',
      redirectUri: redirectUri || `${window.location.origin}/callback`,
      scope: scope || 'openid profile email',
      state: state || '',
    })

    fetch(`/api/get-app-login?${params}`)
      .then(r => r.json())
      .then(data => {
        if (data?.status === 'ok' && data.data?.name) {
          setAppName(data.data.name)
        }
      })
      .catch(() => {})
  }, [clientId, responseType, redirectUri, scope, state])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    try {
      if (!email || !password) {
        throw new Error('Please enter your email and password')
      }

      if (isOAuthFlow) {
        // OAuth flow: login + redirect with code
        // IAM reads OAuth params from query string using camelCase keys (clientId, responseType, redirectUri)
        // and also from the JSON body as fallback. Include both for maximum compatibility.
        const loginUrl = new URL('/api/login', iamUrl)
        loginUrl.searchParams.set('clientId', clientId)
        loginUrl.searchParams.set('responseType', responseType!)
        loginUrl.searchParams.set('redirectUri', redirectUri!)
        if (scope) loginUrl.searchParams.set('scope', scope)
        if (state) loginUrl.searchParams.set('state', state)
        if (codeChallenge) loginUrl.searchParams.set('code_challenge', codeChallenge)
        if (codeChallengeMethod) loginUrl.searchParams.set('code_challenge_method', codeChallengeMethod)

        const res = await fetch(loginUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: responseType === 'token' ? 'token' : 'code',
            organization: org,
            username: email,
            password,
            application: appName || clientId,
            clientId,
            redirectUri: redirectUri!,
            state: state || '',
          }),
        })

        const data = await res.json()
        if (data.status !== 'ok') throw new Error(data.msg || 'Login failed')

        // Redirect back to client
        const redirect = new URL(redirectUri!)
        if (responseType === 'token') {
          redirect.hash = `access_token=${data.data}&token_type=bearer&state=${state || ''}`
        } else {
          redirect.searchParams.set('code', data.data)
          if (state) redirect.searchParams.set('state', state)
        }
        window.location.href = redirect.toString()
      } else {
        // Direct login: get token, store, redirect to account
        const result = await passwordLogin({
          iamUrl,
          org,
          username: email,
          password,
          application: appName || clientId,
        })

        // Store token
        localStorage.setItem('hanzo_access_token', result.token)

        // Decode JWT for user info
        try {
          const payload = JSON.parse(atob(result.token.split('.')[1]))
          localStorage.setItem('hanzo_user', JSON.stringify({
            sub: payload.sub || payload.name,
            name: payload.name,
            displayName: payload.displayName,
            email: payload.email,
            avatar: payload.avatar,
          }))
        } catch {}

        // Redirect to account or home
        window.location.href = '/account'
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSSOLogin = async () => {
    const callbackUri = `${window.location.origin}/callback`
    await startAuthorize({
      iamUrl,
      clientId,
      redirectUri: callbackUri,
      scope: scope ?? 'openid profile email',
    })
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
              onClick={() => { setAuthMethod(tab.key); setError(null) }}
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

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
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
            placeholder="Email or username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input w-full pl-10 py-3 rounded-lg"
            autoComplete="email"
            disabled={isLoading}
          />
        </div>

        {/* Password */}
        {authMethod === 'password' && (
          <div className="relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input w-full pl-10 pr-12 py-3 rounded-lg"
              autoComplete="current-password"
              disabled={isLoading}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-300"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {showPassword ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                ) : (
                  <>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </>
                )}
              </svg>
            </button>
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
            <span className="text-zinc-400">Remember me</span>
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
          className="btn-primary w-full py-3 rounded-lg font-medium disabled:opacity-50 transition-opacity"
          style={{ backgroundColor: branding.colors.primary }}
        >
          {isLoading ? 'Signing in...' : 'Sign In'}
        </button>

        {/* Sign up link */}
        <p className="text-center text-sm text-zinc-500">
          No account?{' '}
          <a
            href={`/signup${typeof window !== 'undefined' ? window.location.search : ''}`}
            className="link"
            style={{ color: branding.colors.primary }}
          >
            Sign up now
          </a>
        </p>

        {/* Social providers / SSO */}
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

            <div className="mt-4 space-y-3">
              {/* Connect Wallet — always first */}
              {branding.auth.socialProviders.includes('metamask') && (
                <button
                  type="button"
                  onClick={() => window.location.href = `/oauth/authorize?provider=metamask&client_id=${clientId}&redirect_uri=${encodeURIComponent(window.location.origin + '/callback')}&scope=openid+email+profile&response_type=code`}
                  className="flex items-center justify-center gap-2 w-full py-3 px-4 border rounded-lg font-medium transition-colors"
                  style={{ borderColor: branding.colors.primary, color: branding.colors.primary }}
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="6" width="20" height="14" rx="2" />
                    <path d="M16 14h.01" />
                    <path d="M2 10h20" />
                  </svg>
                  Connect Wallet
                </button>
              )}

              <div className="grid grid-cols-2 gap-3">
                {branding.auth.socialProviders.includes('google') && (
                  <button
                    type="button"
                    onClick={() => window.location.href = `/oauth/authorize?provider=google&client_id=${clientId}&redirect_uri=${encodeURIComponent(window.location.origin + '/callback')}&scope=openid+email+profile&response_type=code`}
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
                    onClick={() => window.location.href = `/oauth/authorize?provider=github&client_id=${clientId}&redirect_uri=${encodeURIComponent(window.location.origin + '/callback')}&scope=openid+email+profile&response_type=code`}
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
