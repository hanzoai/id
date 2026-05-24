'use client'

export const runtime = 'edge'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { exchangeCode } from '@/lib/oauth'
import { getIamUrl, getDefaultClientId } from '@/lib/iam'

/**
 * Claim a referral code after successful login/signup.
 * Fire-and-forget: never blocks redirect on failure.
 */
function claimReferral(accessToken: string, userId: string, email: string) {
  const refCode = sessionStorage.getItem('hanzo_ref_code')
  if (!refCode) return

  sessionStorage.removeItem('hanzo_ref_code')

  fetch('https://commerce.hanzo.ai/api/v1/referral/claim', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ code: refCode, userId, email }),
  }).catch(() => {})
}

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
      const idToken = searchParams.get('id_token')
      if (idToken) {
        localStorage.setItem('hanzo_id_token', idToken)
      }

      // Extract user info: prefer id_token (has full claims), fall back to access_token
      try {
        const idPayload = idToken
          ? JSON.parse(atob(idToken.split('.')[1]))
          : null
        const atPayload = JSON.parse(atob(accessToken.split('.')[1]))
        const p = idPayload || atPayload
        localStorage.setItem('hanzo_user', JSON.stringify({
          sub: p.sub || atPayload.sub || atPayload.name,
          name: p.name || p.preferred_username || atPayload.name,
          displayName: p.displayName || p.name || p.preferred_username,
          email: p.email || atPayload.email,
          avatar: p.avatar || p.picture || p.permanentAvatar,
        }))
        claimReferral(accessToken, p.sub || atPayload.sub || atPayload.name, p.email || atPayload.email)
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
      if (tokens.id_token) {
        localStorage.setItem('hanzo_id_token', tokens.id_token)
      }

      // Extract user info: prefer id_token (has full claims), fall back to access_token
      try {
        const idPayload = tokens.id_token
          ? JSON.parse(atob(tokens.id_token.split('.')[1]))
          : null
        const atPayload = JSON.parse(atob(tokens.access_token.split('.')[1]))
        const p = idPayload || atPayload
        localStorage.setItem('hanzo_user', JSON.stringify({
          sub: p.sub || atPayload.sub || atPayload.name,
          name: p.name || p.preferred_username || atPayload.name,
          displayName: p.displayName || p.name || p.preferred_username,
          email: p.email || atPayload.email,
          avatar: p.avatar || p.picture || p.permanentAvatar,
        }))
        claimReferral(tokens.access_token, p.sub || atPayload.sub || atPayload.name, p.email || atPayload.email)
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
