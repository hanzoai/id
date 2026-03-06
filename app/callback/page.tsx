'use client'

export const runtime = 'edge'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { exchangeCode } from '@/lib/oauth'
import { getIamUrl, getDefaultClientId } from '@/lib/iam'

function CallbackHandler() {
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    handleCallback()
  }, [])

  async function handleCallback() {
    const errorParam = searchParams.get('error')
    if (errorParam) {
      setError(searchParams.get('error_description') || errorParam)
      return
    }

    // Token passthrough from social login / bridge callback
    const accessToken = searchParams.get('access_token')
    if (accessToken) {
      localStorage.setItem('hanzo_access_token', accessToken)
      const refreshToken = searchParams.get('refresh_token')
      if (refreshToken) {
        localStorage.setItem('hanzo_refresh_token', refreshToken)
      }

      // Decode JWT for user info
      try {
        const payload = JSON.parse(atob(accessToken.split('.')[1]))
        localStorage.setItem('hanzo_user', JSON.stringify({
          sub: payload.sub || payload.name,
          name: payload.name,
          displayName: payload.displayName,
          email: payload.email,
          avatar: payload.avatar,
        }))
      } catch {}

      const postLoginRedirect = sessionStorage.getItem('hanzo_auth_post_login_redirect')
      if (postLoginRedirect) {
        sessionStorage.removeItem('hanzo_auth_post_login_redirect')
        window.location.href = postLoginRedirect
      } else {
        window.location.href = '/account'
      }
      return
    }

    // PKCE authorization code flow
    const code = searchParams.get('code')
    const state = searchParams.get('state')

    if (!code || !state) {
      setError('Missing authorization code or state')
      return
    }

    try {
      const host = window.location.hostname
      const iamUrl = getIamUrl(host)
      const clientId = getDefaultClientId(host)
      const redirectUri = `${window.location.origin}/callback`

      const tokens = await exchangeCode({
        iamUrl,
        code,
        state,
        clientId,
        redirectUri,
      })

      localStorage.setItem('hanzo_access_token', tokens.access_token)
      if (tokens.refresh_token) {
        localStorage.setItem('hanzo_refresh_token', tokens.refresh_token)
      }

      try {
        const payload = JSON.parse(atob(tokens.access_token.split('.')[1]))
        localStorage.setItem('hanzo_user', JSON.stringify({
          sub: payload.sub || payload.name,
          name: payload.name,
          displayName: payload.displayName,
          email: payload.email,
          avatar: payload.avatar,
        }))
      } catch {}

      const postLoginRedirect = sessionStorage.getItem('hanzo_auth_post_login_redirect')
      if (postLoginRedirect) {
        sessionStorage.removeItem('hanzo_auth_post_login_redirect')
        window.location.href = postLoginRedirect
      } else {
        window.location.href = '/account'
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    }
  }

  if (error) {
    return (
      <div className="login-card max-w-md w-full p-8 text-center">
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
        <a href="/login" className="link text-sm">Back to login</a>
      </div>
    )
  }

  return (
    <div className="text-center">
      <div className="animate-spin w-8 h-8 border-2 border-zinc-700 border-t-white rounded-full mx-auto mb-4" />
      <p className="text-zinc-400 text-sm">Completing sign in...</p>
    </div>
  )
}

export default function CallbackPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <Suspense fallback={
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-zinc-700 border-t-white rounded-full mx-auto mb-4" />
          <p className="text-zinc-400 text-sm">Loading...</p>
        </div>
      }>
        <CallbackHandler />
      </Suspense>
    </div>
  )
}
