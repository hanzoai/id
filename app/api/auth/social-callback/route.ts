/**
 * Server-side social OAuth callback handler.
 *
 * When a user logs in via Google/GitHub/etc, the social provider redirects
 * back to /callback with ?code=&state=. The IAM SPA callback relies on
 * sessionStorage which breaks through our proxy layer, so we handle the
 * full exchange server-side.
 *
 * Flow:
 * 1. Decode state (base64 query string or JSON) to extract app/org/provider
 * 2. Read _oauth_ctx cookie as fallback context
 * 3. POST to IAM /api/login with type:'token' to complete the login
 * 4. Redirect to the original redirect_uri with tokens
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveClient } from '@/lib/clients'
import { getIamUrl } from '@/lib/iam'

export const runtime = 'edge'

// Allowed redirect origins — must match bridge handler allowlist
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
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:4000',
  'http://localhost:5173',
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
  const host = url.hostname

  const iamOrigin = getIamUrl(host)
  const iamHost = new URL(iamOrigin).host

  if (!code || !state) {
    return NextResponse.redirect(new URL('/login?error=missing_code_or_state', url.origin))
  }

  // Reject oversized state to prevent abuse
  if (state.length > 4096) {
    return NextResponse.redirect(new URL('/login?error=invalid_state', url.origin))
  }

  // Decode state — IAM encodes as base64 query string or JSON
  let stateParams = new URLSearchParams()
  let stateObj: Record<string, string> = {}
  try {
    const decoded = atob(state)
    if (decoded.startsWith('?') || decoded.includes('=')) {
      stateParams = new URLSearchParams(decoded)
    } else {
      stateObj = JSON.parse(decoded)
    }
  } catch {
    return NextResponse.redirect(new URL('/login?error=invalid_state', url.origin))
  }

  // Read _oauth_ctx cookie as fallback
  const cookieHeader = request.headers.get('cookie') || ''
  let oauthCtx: Record<string, string> = {}
  const ctxMatch = cookieHeader.match(/_oauth_ctx=([^;]+)/)
  if (ctxMatch) {
    try {
      oauthCtx = JSON.parse(atob(decodeURIComponent(ctxMatch[1])))
    } catch {}
  }

  // Resolve context from state (primary), cookie (secondary), JSON (tertiary)
  const application = stateParams.get('application') || oauthCtx.application || stateObj.application || ''
  const provider = stateParams.get('provider') || oauthCtx.provider || stateObj.provider || ''
  const method = stateParams.get('method') || stateObj.method || 'link'
  const stateClientId = stateParams.get('client_id') || oauthCtx.clientId || ''
  const originalRedirectUri = stateParams.get('redirect_uri') || oauthCtx.redirectUri || stateObj.redirectUri || ''

  // Resolve organization from client map — ALWAYS prefer client map over untrusted sources
  // to prevent cross-tenant org bypass attacks
  let organization = ''
  if (stateClientId) {
    const client = resolveClient(stateClientId)
    if (client) organization = client.organization
  }
  // Only fall back to cookie/state if no client map match, and validate it's a known org
  if (!organization) {
    const KNOWN_ORGS = ['hanzo', 'lux', 'zoo', 'pars', 'zen', 'adnexus']
    const candidateOrg = oauthCtx.organization || stateObj.organization || ''
    if (KNOWN_ORGS.includes(candidateOrg)) {
      organization = candidateOrg
    }
  }

  // Call IAM to complete the social login
  // type:'token' because our IAM version has a bug where type:'code'
  // maps to an empty grant_type and fails
  const loginRes = await fetch(`${iamOrigin}/api/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Cookie': cookieHeader,
      'Host': iamHost,
    },
    body: JSON.stringify({
      type: 'token',
      code,
      state: 'hanzo',
      redirectUri: `${url.origin}/callback`,
      application,
      organization,
      provider,
      method,
    }),
  })

  const loginData = await loginRes.json().catch(() => ({} as Record<string, unknown>))

  // Clear the oauth context cookie
  const clearCookie = '_oauth_ctx=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'

  if (loginData.status === 'ok' && loginData.data) {
    // Validate redirect URI against allowlist to prevent open redirect
    const candidateRedirect = originalRedirectUri
      ? originalRedirectUri.replaceAll(iamHost, host)
      : `${url.origin}/login`
    const targetRedirectUri = validateRedirectOrigin(candidateRedirect, `${url.origin}/login`)
    const targetUrl = new URL(targetRedirectUri)
    targetUrl.searchParams.set('access_token', loginData.data as string)
    targetUrl.searchParams.set('refresh_token', (loginData.data2 as string) || '')
    targetUrl.searchParams.set('provider', 'hanzo')
    targetUrl.searchParams.set('status', '200')
    return new NextResponse(null, {
      status: 302,
      headers: {
        'Location': targetUrl.toString(),
        'Set-Cookie': clearCookie,
      },
    })
  }

  // Error path — never include sensitive debug info in redirect params
  if (originalRedirectUri) {
    const candidateError = originalRedirectUri.replaceAll(iamHost, host)
    const safeErrorRedirect = validateRedirectOrigin(candidateError, `${url.origin}/login`)
    const errorUrl = new URL(safeErrorRedirect)
    errorUrl.searchParams.set('error', (loginData.msg as string) || 'social_login_failed')
    return new NextResponse(null, {
      status: 302,
      headers: {
        'Location': errorUrl.toString(),
        'Set-Cookie': clearCookie,
      },
    })
  }

  return new NextResponse(null, {
    status: 302,
    headers: {
      'Location': `${url.origin}/login?error=${encodeURIComponent((loginData.msg as string) || 'social_login_failed')}`,
      'Set-Cookie': clearCookie,
    },
  })
}
