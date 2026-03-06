'use client'

export const runtime = 'edge'

import { useState } from 'react'
import { getIamUrl, getOrg } from '@/lib/iam'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const host = typeof window !== 'undefined' ? window.location.hostname : 'hanzo.id'
  const iamUrl = getIamUrl(host)
  const org = getOrg(host)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    try {
      if (!email) throw new Error('Please enter your email address')

      const res = await fetch(`${iamUrl}/api/send-verification-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dest: email,
          type: 'reset',
          organization: org,
          applicationId: `admin/${org}`,
        }),
      })

      const data = await res.json()
      if (data.status === 'error') throw new Error(data.msg || 'Failed to send reset email')

      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-black p-8">
      <div className="login-card w-full max-w-md p-8">
        <h1 className="text-2xl font-bold text-white mb-2">Reset password</h1>
        <p className="text-zinc-400 text-sm mb-6">
          {sent
            ? 'Check your email for a password reset link.'
            : 'Enter your email and we\'ll send you a reset link.'}
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {sent ? (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm">
              If an account exists for {email}, you will receive a password reset email shortly.
            </div>
            <a href="/login" className="block text-center link text-sm">
              Back to login
            </a>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
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
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary w-full py-3 rounded-lg font-medium disabled:opacity-50"
            >
              {isLoading ? 'Sending...' : 'Send reset link'}
            </button>

            <p className="text-center text-sm text-zinc-500">
              Remember your password?{' '}
              <a href="/login" className="link">Sign in</a>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
