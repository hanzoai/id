'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import type { BrandingConfig } from '@/lib/branding'
import { getIamUrl, getOrg, getDefaultClientId } from '@/lib/iam'

interface SignUpFormProps {
  branding: BrandingConfig
}

export default function SignUpForm({ branding }: SignUpFormProps) {
  const searchParams = useSearchParams()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const host = typeof window !== 'undefined' ? window.location.hostname : 'hanzo.id'
  const iamUrl = getIamUrl(host)
  const org = getOrg(host)
  const clientId = searchParams.get('client_id') ?? searchParams.get('clientId') ?? getDefaultClientId(host)

  // Resolve the IAM application name from clientId.
  // IAM's /api/signup expects the application NAME (e.g. "app-hanzobot"),
  // not the OAuth client_id (e.g. "hanzobot-client-id").
  const [appName, setAppName] = useState<string | null>(null)

  useEffect(() => {
    if (!clientId) return

    const params = new URLSearchParams({
      clientId,
      type: 'code',
      responseType: 'code',
      redirectUri: `${window.location.origin}/callback`,
      scope: 'openid profile email',
      state: '',
    })

    fetch(`/api/get-app-login?${params}`)
      .then(r => r.json())
      .then(data => {
        if (data?.status === 'ok' && data.data?.name) {
          setAppName(data.data.name)
        }
      })
      .catch(() => {})
  }, [clientId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    try {
      if (!email || !password) {
        throw new Error('Please fill in all required fields')
      }

      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters')
      }

      const res = await fetch(`${iamUrl}/api/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization: org,
          application: appName || clientId,
          name: email.split('@')[0],
          displayName: name || email.split('@')[0],
          email,
          password,
        }),
      })

      const data = await res.json()
      if (data.status !== 'ok') {
        throw new Error(data.msg || 'Sign up failed')
      }

      // Redirect to login with success message
      const loginUrl = new URL('/login', window.location.origin)
      // Preserve OAuth params
      const params = ['client_id', 'clientId', 'redirect_uri', 'redirectUri', 'response_type', 'responseType', 'scope', 'state']
      for (const p of params) {
        const v = searchParams.get(p)
        if (v) loginUrl.searchParams.set(p, v)
      }
      loginUrl.searchParams.set('registered', '1')
      window.location.href = loginUrl.toString()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-2">Create account</h2>
      <p className="text-zinc-400 text-sm mb-6">
        Sign up for {branding.orgName}
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Name */}
        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <input
            type="text"
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input w-full pl-10 py-3 rounded-lg"
            autoComplete="name"
            disabled={isLoading}
          />
        </div>

        {/* Email */}
        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input w-full pl-10 py-3 rounded-lg"
            autoComplete="email"
            disabled={isLoading}
            required
          />
        </div>

        {/* Password */}
        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="Password (min 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input w-full pl-10 pr-12 py-3 rounded-lg"
            autoComplete="new-password"
            disabled={isLoading}
            required
            minLength={8}
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

        <button
          type="submit"
          disabled={isLoading}
          className="btn-primary w-full py-3 rounded-lg font-medium disabled:opacity-50 transition-opacity"
          style={{ backgroundColor: branding.colors.primary }}
        >
          {isLoading ? 'Creating account...' : 'Create Account'}
        </button>

        <p className="text-center text-sm text-zinc-500">
          Already have an account?{' '}
          <a
            href={`/login${typeof window !== 'undefined' ? window.location.search : ''}`}
            className="link"
            style={{ color: branding.colors.primary }}
          >
            Sign in
          </a>
        </p>

        {/* Terms */}
        {(branding.links.terms || branding.links.privacy) && (
          <p className="text-center text-xs text-zinc-500 mt-4">
            By creating an account, you agree to our{' '}
            {branding.links.terms && (
              <a href={branding.links.terms} className="hover:text-zinc-300">Terms</a>
            )}
            {branding.links.terms && branding.links.privacy && ' and '}
            {branding.links.privacy && (
              <a href={branding.links.privacy} className="hover:text-zinc-300">Privacy Policy</a>
            )}
          </p>
        )}
      </form>
    </div>
  )
}
