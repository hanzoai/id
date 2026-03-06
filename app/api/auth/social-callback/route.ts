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
  } catch {}

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

  // Resolve organization from client map
  let organization = oauthCtx.organization || stateObj.organization || ''
  if (!organization && stateClientId) {
    const client = resolveClient(stateClientId)
    if (client) organization = client.organization
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
    const targetRedirectUri = originalRedirectUri
      ? originalRedirectUri.replaceAll(iamHost, host)
      : `${url.origin}/login`
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

  // Error path
  const debugInfo = JSON.stringify({
    msg: loginData.msg || 'unknown',
    app: application,
    org: organization,
    prov: provider,
  })

  if (originalRedirectUri) {
    const errorUrl = new URL(originalRedirectUri.replaceAll(iamHost, host))
    errorUrl.searchParams.set('error', (loginData.msg as string) || 'social_login_failed')
    errorUrl.searchParams.set('debug', debugInfo)
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
