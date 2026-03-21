/**
 * OAuth bridge callback for downstream apps (Platform, MPC, etc.)
 *
 * Handles the code exchange on behalf of apps that need IAM tokens.
 * Decodes the state param to determine the redirect target.
 *
 * Usage:
 *   GET /api/auth/bridge?code=...&state=base64({redirect,clientId,app})
 *
 * The state is a base64-encoded JSON object:
 *   { redirect: "https://platform.hanzo.ai/login", clientId: "...", app: "platform" }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getIamUrl } from '@/lib/iam'

export const runtime = 'edge'

// Allowed redirect origins for security
const ALLOWED_ORIGINS = [
  'https://platform.hanzo.ai',
  'https://console.hanzo.ai',
  'https://cloud.hanzo.ai',
  'https://mpc.hanzo.ai',
  'https://mpc.lux.network',
  'https://mpc.zoo.network',
  'https://mpc.pars.network',
  'https://commerce.hanzo.ai',
  'https://billing.hanzo.ai',
  'https://analytics.hanzo.ai',
  'https://insights.hanzo.ai',
  'https://hanzo.ai',
  'https://lux.id',
  'https://zoo.id',
  'https://pars.id',
  'https://hanzo.id',
  ...(process.env.NODE_ENV !== 'production' ? [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:4000',
    'http://localhost:5173',
  ] : []),
]

function validateRedirectOrigin(redirect: string, fallback: string): string {
  try {
    const url = new URL(redirect)
    if (ALLOWED_ORIGINS.some(o => url.origin === new URL(o).origin)) {
      return redirect
    }
  } catch {}
  return fallback
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const directAccessToken = url.searchParams.get('access_token')
  const directRefreshToken = url.searchParams.get('refresh_token')
  const host = url.hostname

  const iamOrigin = getIamUrl(host)
  const iamHost = new URL(iamOrigin).host

  const defaultRedirect = `${url.origin}/login`

  // Reject oversized state
  if (state && state.length > 4096) {
    return NextResponse.redirect(`${url.origin}/login?error=invalid_state`)
  }

  // Decode state for redirect target and client info
  let redirect = defaultRedirect
  let clientId = process.env.NEXT_PUBLIC_CLIENT_ID || 'app-hanzo'
  let codeVerifier = ''
  try {
    const decoded = JSON.parse(atob(state || ''))
    if (decoded.redirect) {
      redirect = validateRedirectOrigin(decoded.redirect, defaultRedirect)
    }
    if (decoded.clientId) {
      clientId = decoded.clientId
    }
    if (decoded.code_verifier) {
      codeVerifier = decoded.code_verifier
    }
  } catch {}

  const redirectUrl = new URL(redirect)

  // Direct token passthrough (from implicit flow / password login)
  if (directAccessToken) {
    redirectUrl.searchParams.set('access_token', directAccessToken)
    redirectUrl.searchParams.set('refresh_token', directRefreshToken || '')
    redirectUrl.searchParams.set('provider', 'hanzo')
    redirectUrl.searchParams.set('status', '200')
    return NextResponse.redirect(redirectUrl.toString())
  }

  // Authorization code exchange
  if (!code) {
    redirectUrl.searchParams.set('error', 'no_code')
    return NextResponse.redirect(redirectUrl.toString())
  }

  const callbackUri = `${url.origin}/api/auth/bridge`
  const tokenPayload: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: callbackUri,
  }

  // Forward PKCE code_verifier if provided (prevents authorization code interception)
  if (codeVerifier) {
    tokenPayload.code_verifier = codeVerifier
  }

  const clientSecret = process.env.IAM_CLIENT_SECRET || process.env.HANZO_IAM_CLIENT_SECRET
  if (clientSecret) {
    tokenPayload.client_secret = clientSecret
  }

  const tokenRes = await fetch(`${iamOrigin}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Host': iamHost,
    },
    body: JSON.stringify(tokenPayload),
  })

  const tokens = await tokenRes.json().catch(() => ({} as Record<string, unknown>))

  if (tokens.access_token) {
    redirectUrl.searchParams.set('access_token', tokens.access_token as string)
    redirectUrl.searchParams.set('refresh_token', (tokens.refresh_token as string) || '')
    redirectUrl.searchParams.set(
      'expires_at',
      tokens.expires_in
        ? String(Math.floor(Date.now() / 1000) + Number(tokens.expires_in))
        : '0',
    )
    redirectUrl.searchParams.set('provider', 'hanzo')
    redirectUrl.searchParams.set('status', '200')
  } else {
    redirectUrl.searchParams.set('error', (tokens.error as string) || 'token_exchange_failed')
    redirectUrl.searchParams.set(
      'error_description',
      (tokens.error_description as string) || (tokens.message as string) || 'Failed to exchange code',
    )
  }

  return NextResponse.redirect(redirectUrl.toString())
}
