import { NextRequest, NextResponse } from 'next/server'

/**
 * Next.js middleware — the core proxy layer for Hanzo ID.
 *
 * Handles:
 * 1. Multi-tenant hostname → org/IAM resolution
 * 2. RFC 6749/OIDC path normalization (standard → IAM backend paths)
 * 3. Social provider redirect with _oauth_ctx cookie
 * 4. OIDC discovery body rewriting
 * 5. Location header rewriting
 *
 * This is a white-label login portal. Any domain pointing here gets a
 * working OIDC/OAuth2 provider experience. Configure via env vars for
 * self-hosted deployments, or use the built-in tenant map.
 */

// --- Tenant configuration ---

interface TenantConfig {
  org: string
  iamOrigin: string
  publicOrigin: string
}

const TENANTS: Record<string, TenantConfig> = {
  'hanzo.id': {
    org: 'hanzo',
    iamOrigin: 'https://iam.hanzo.ai',
    publicOrigin: 'https://hanzo.id',
  },
  'id.hanzo.ai': {
    org: 'hanzo',
    iamOrigin: 'https://iam.hanzo.ai',
    publicOrigin: 'https://id.hanzo.ai',
  },
  'lux.id': {
    org: 'lux',
    iamOrigin: 'https://iam.hanzo.ai',
    publicOrigin: 'https://lux.id',
  },
  'iam.lux.network': {
    org: 'lux',
    iamOrigin: 'https://iam.hanzo.ai',
    publicOrigin: 'https://iam.lux.network',
  },
  'id.lux.cloud': {
    org: 'lux',
    iamOrigin: 'https://iam.hanzo.ai',
    publicOrigin: 'https://id.lux.cloud',
  },
  'id.lux.network': {
    org: 'lux',
    iamOrigin: 'https://iam.hanzo.ai',
    publicOrigin: 'https://id.lux.network',
  },
  'id.lux-dev.network': {
    org: 'lux',
    iamOrigin: 'https://iam.hanzo.ai',
    publicOrigin: 'https://id.lux-dev.network',
  },
  'id.lux-test.network': {
    org: 'lux',
    iamOrigin: 'https://iam.hanzo.ai',
    publicOrigin: 'https://id.lux-test.network',
  },
  'id-dev.hanzo.ai': {
    org: 'hanzo',
    iamOrigin: 'https://iam.hanzo.ai',
    publicOrigin: 'https://id-dev.hanzo.ai',
  },
  'id-test.hanzo.ai': {
    org: 'hanzo',
    iamOrigin: 'https://iam.hanzo.ai',
    publicOrigin: 'https://id-test.hanzo.ai',
  },
  'zoolabs.id': {
    org: 'zoo',
    iamOrigin: 'https://iam.hanzo.ai',
    publicOrigin: 'https://zoolabs.id',
  },
  'id.zoo.network': {
    org: 'zoo',
    iamOrigin: 'https://iam.hanzo.ai',
    publicOrigin: 'https://id.zoo.network',
  },
  'id.zoo-dev.network': {
    org: 'zoo',
    iamOrigin: 'https://iam.hanzo.ai',
    publicOrigin: 'https://id.zoo-dev.network',
  },
  'id.zoo-test.network': {
    org: 'zoo',
    iamOrigin: 'https://iam.hanzo.ai',
    publicOrigin: 'https://id.zoo-test.network',
  },
  'id.hanzo.network': {
    org: 'hanzo',
    iamOrigin: 'https://iam.hanzo.ai',
    publicOrigin: 'https://id.hanzo.network',
  },
  'id.hanzo-dev.network': {
    org: 'hanzo',
    iamOrigin: 'https://iam.hanzo.ai',
    publicOrigin: 'https://id.hanzo-dev.network',
  },
  'id.hanzo-test.network': {
    org: 'hanzo',
    iamOrigin: 'https://iam.hanzo.ai',
    publicOrigin: 'https://id.hanzo-test.network',
  },
  'pars.id': {
    org: 'pars',
    iamOrigin: 'https://iam.hanzo.ai',
    publicOrigin: 'https://pars.id',
  },
  'id.pars.network': {
    org: 'pars',
    iamOrigin: 'https://iam.hanzo.ai',
    publicOrigin: 'https://id.pars.network',
  },
  'zen.id': {
    org: 'zen',
    iamOrigin: 'https://iam.hanzo.ai',
    publicOrigin: 'https://zen.id',
  },
  'id.ad.nexus': {
    org: 'adnexus',
    iamOrigin: 'https://iam.hanzo.ai',
    publicOrigin: 'https://id.ad.nexus',
  },
  'auth.hanzo.ai': {
    org: 'hanzo',
    iamOrigin: 'https://iam.hanzo.ai',
    publicOrigin: 'https://auth.hanzo.ai',
  },
}

function getTenant(hostname: string): TenantConfig {
  const host = hostname.split(':')[0]
  const tenant = TENANTS[host]
  if (tenant) return tenant

  // Env override for self-hosted / fork deployments
  const envIamOrigin = process.env.IAM_ORIGIN || process.env.NEXT_PUBLIC_IAM_URL
  return {
    org: process.env.NEXT_PUBLIC_ORG || 'hanzo',
    iamOrigin: envIamOrigin || 'https://iam.hanzo.ai',
    publicOrigin: `https://${host}`,
  }
}

// --- RFC path normalization ---

const PATH_REWRITES: Record<string, string> = {
  // NOTE: /oauth/authorize is handled explicitly in middleware() — NOT here.
  // RFC 6749 — Token (exchange, refresh, client_credentials all use this)
  '/oauth/token':        '/api/login/oauth/access_token',
  // RFC 7662 — Token Introspection
  '/oauth/introspect':   '/api/login/oauth/introspect',
  // RFC 7009 — Token Revocation
  '/oauth/revoke':       '/api/login/oauth/revoke',
  // OIDC Core — UserInfo
  '/oauth/userinfo':     '/api/userinfo',
  // OIDC — Logout
  '/oauth/logout':       '/login/oauth/logout',
  // RFC 8628 — Device Authorization
  '/oauth/device':       '/api/login/oauth/device',
  // JWKS — standard /.well-known/jwks.json → IAM's /.well-known/jwks
  '/.well-known/jwks.json': '/.well-known/jwks',
  // RFC 8414 — OAuth metadata
  '/.well-known/oauth-authorization-server': '/.well-known/openid-configuration',
}

// Paths to proxy to IAM backend (prefix match)
const IAM_PATH_PREFIXES = [
  '/api/',
  '/oauth/',
  '/login/oauth/',
  '/.well-known/',
  '/cas/',
  '/scim/',
]

// Paths handled by the Next.js app (login UI)
const APP_PATHS = [
  '/login',
  '/signup',
  '/callback',
  '/account',
  '/forgot-password',
  '/logout',
]

function shouldProxyToIAM(pathname: string): boolean {
  // Don't proxy Next.js internal paths or our own API routes
  if (pathname.startsWith('/_next/')) return false
  if (pathname.startsWith('/api/auth/')) return false
  if (pathname.startsWith('/api/logout')) return false

  // Don't proxy paths handled by the Next.js app
  // But DO proxy /login/oauth/* (IAM backend paths rewritten from /oauth/*)
  if (pathname.startsWith('/login/oauth/')) return true
  for (const p of APP_PATHS) {
    if (pathname === p || pathname.startsWith(p + '/')) return false
  }

  return IAM_PATH_PREFIXES.some(p => pathname.startsWith(p))
}

// --- Social provider redirect handling ---

/**
 * When /login/oauth/authorize or /oauth/authorize is called with a ?provider=
 * param, we need to:
 * 1. Resolve the app/org from the client_id
 * 2. Set an _oauth_ctx cookie so the callback handler knows context
 * 3. Proxy to IAM which redirects to the social provider
 */
async function handleSocialProviderRedirect(
  request: NextRequest,
  url: URL,
  pathname: string,
  tenant: TenantConfig,
): Promise<NextResponse | null> {
  if (!url.searchParams.has('provider')) return null

  const provider = url.searchParams.get('provider')!
  const clientId = url.searchParams.get('client_id') || ''
  const iamHost = new URL(tenant.iamOrigin).host

  // Resolve app/org via IAM API, fall back to client map
  let appName = ''
  let appOwner = ''

  if (clientId) {
    // Dynamic import to keep middleware lean
    const { resolveClient } = await import('@/lib/clients')

    try {
      const loginParams = new URLSearchParams({
        clientId,
        type: 'code',
        responseType: url.searchParams.get('response_type') || 'code',
        redirectUri: url.searchParams.get('redirect_uri') || `${url.origin}/callback`,
        scope: url.searchParams.get('scope') || 'openid profile email',
        state: url.searchParams.get('state') || '',
      })
      const appLoginRes = await fetch(`${tenant.iamOrigin}/api/get-app-login?${loginParams}`)
      const appLoginData = await appLoginRes.json()
      if (appLoginData?.status === 'ok' && appLoginData.data) {
        appName = appLoginData.data.name || ''
        appOwner = appLoginData.data.owner || appLoginData.data.organization || ''
      }
    } catch {}

    if (!appName) {
      const client = resolveClient(clientId)
      if (client) {
        appName = client.application
        appOwner = client.organization
      }
    }
  }

  // Store OAuth context in cookie for the callback handler
  const oauthContext = JSON.stringify({
    application: appName,
    organization: appOwner,
    provider,
    redirectUri: url.searchParams.get('redirect_uri') || `${url.origin}/callback`,
    clientId,
  })
  const oauthContextCookie = `_oauth_ctx=${encodeURIComponent(btoa(oauthContext))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`

  // Proxy to IAM — it manages the full social OAuth flow
  const iamUrl = new URL('/login/oauth/authorize' + url.search, tenant.iamOrigin)
  const headers = new Headers(request.headers)
  headers.set('Host', iamHost)
  headers.delete('connection')

  const iamResponse = await fetch(iamUrl.toString(), {
    method: request.method,
    headers,
    body: request.body,
    redirect: 'manual',
  })

  const responseHeaders = new Headers(iamResponse.headers)
  responseHeaders.append('Set-Cookie', oauthContextCookie)

  // Rewrite IAM redirects to our domain
  const location = responseHeaders.get('location')
  if (location) {
    responseHeaders.set('location', location.replaceAll(tenant.iamOrigin, tenant.publicOrigin))
  }

  return new NextResponse(iamResponse.body, {
    status: iamResponse.status,
    statusText: iamResponse.statusText,
    headers: responseHeaders,
  })
}

// --- Callback routing ---

/**
 * Route /callback to the right handler:
 * - If ?code=&state= present and state looks like a social callback → server-side handler
 * - Otherwise → let the Next.js callback page handle it (PKCE flow)
 */
function isSocialCallback(url: URL): boolean {
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) return false

  // IAM social callbacks have base64-encoded state starting with "?"
  try {
    const decoded = atob(state)
    if (decoded.startsWith('?') || decoded.includes('application=')) return true
  } catch {}

  return false
}

// --- Main middleware ---

export async function middleware(request: NextRequest) {
  const url = new URL(request.url)
  let pathname = url.pathname
  const hostname = url.hostname

  const tenant = getTenant(hostname)

  // Route social callbacks to server-side handler
  if (pathname === '/callback' && isSocialCallback(url)) {
    const socialUrl = new URL('/api/auth/social-callback' + url.search, url.origin)
    return NextResponse.rewrite(socialUrl)
  }

  // Handle /oauth/authorize and /login/oauth/authorize
  if (pathname === '/oauth/authorize' || pathname === '/login/oauth/authorize') {
    // Social login: proxy to IAM with ?provider= param
    if (url.searchParams.has('provider')) {
      const socialResponse = await handleSocialProviderRedirect(request, url, pathname, tenant)
      if (socialResponse) return socialResponse
    }

    // If user already has an IAM session, try to proxy to IAM to complete OAuth authorize.
    // IAM will auto-authorize and redirect (3xx) if the session is valid for this app.
    // If IAM returns 200 (its built-in login page), fall through to our own login UI.
    const sessionCookie = request.cookies.get('iam_session_id')?.value
    if (sessionCookie) {
      const iamUrl = new URL('/login/oauth/authorize' + url.search, tenant.iamOrigin)
      const iamHost = new URL(tenant.iamOrigin).host

      const headers = new Headers(request.headers)
      headers.set('Host', iamHost)
      headers.set('Cookie', `iam_session_id=${sessionCookie}`)
      headers.delete('connection')

      const iamResponse = await fetch(iamUrl.toString(), {
        method: 'GET',
        headers,
        redirect: 'manual',
      })

      // Only use IAM's response if it's a redirect (auto-authorize succeeded).
      // If IAM returns 200 (its login page), fall through to our own login UI.
      if (iamResponse.status >= 300 && iamResponse.status < 400) {
        const response = new NextResponse(iamResponse.body, {
          status: iamResponse.status,
          statusText: iamResponse.statusText,
          headers: iamResponse.headers,
        })

        const location = response.headers.get('location')
        if (location) {
          response.headers.set(
            'location',
            location.replaceAll(tenant.iamOrigin, tenant.publicOrigin)
          )
        }

        return response
      }
      // IAM didn't auto-authorize — show our own login UI below
    }

    // Show our own login UI with OAuth context
    // (Don't proxy to IAM's built-in SPA — hanzo.id IS the login UI)
    const loginUrl = new URL('/login' + url.search, url.origin)
    return NextResponse.redirect(loginUrl)
  }

  // Apply RFC path normalization
  const rewrittenPath = PATH_REWRITES[pathname]
  if (rewrittenPath) {
    pathname = rewrittenPath
  }

  // Proxy IAM paths to backend
  if (shouldProxyToIAM(pathname)) {
    const iamUrl = new URL(pathname + url.search, tenant.iamOrigin)
    const iamHost = new URL(tenant.iamOrigin).host

    const headers = new Headers(request.headers)
    headers.set('Host', iamHost)
    headers.delete('connection')

    const iamResponse = await fetch(iamUrl.toString(), {
      method: request.method,
      headers,
      body: request.body,
      redirect: 'manual',
    })

    // Rewrite OIDC discovery documents
    const isDiscovery = pathname === '/.well-known/openid-configuration'
      || pathname === '/.well-known/oauth-authorization-server'
    if (isDiscovery && iamResponse.ok) {
      const contentType = iamResponse.headers.get('content-type') || ''
      if (contentType.includes('json')) {
        try {
          let body = await iamResponse.text()
          // Rewrite IAM backend origin to public tenant origin
          body = body.replaceAll(tenant.iamOrigin, tenant.publicOrigin)
          // Normalize legacy IAM backend paths to RFC standard paths
          body = body.replaceAll('/login/oauth/authorize', '/oauth/authorize')
          body = body.replaceAll('/api/login/oauth/access_token', '/oauth/token')
          body = body.replaceAll('/api/login/oauth/refresh_token', '/oauth/token')
          body = body.replaceAll('/api/login/oauth/introspect', '/oauth/introspect')
          body = body.replaceAll('/api/login/oauth/revoke', '/oauth/revoke')
          body = body.replaceAll('/login/oauth/logout', '/oauth/logout')
          body = body.replaceAll('/api/login/oauth/device', '/oauth/device')
          body = body.replaceAll('/api/userinfo', '/oauth/userinfo')
          return new NextResponse(body, {
            status: iamResponse.status,
            headers: iamResponse.headers,
          })
        } catch {}
      }
    }

    // Clone response and rewrite redirect Location headers
    const response = new NextResponse(iamResponse.body, {
      status: iamResponse.status,
      statusText: iamResponse.statusText,
      headers: iamResponse.headers,
    })

    const location = response.headers.get('location')
    if (location) {
      response.headers.set(
        'location',
        location.replaceAll(tenant.iamOrigin, tenant.publicOrigin)
      )
    }

    return response
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/api/:path*',
    '/oauth/:path*',
    '/login/oauth/:path*',
    '/.well-known/:path*',
    '/callback',
    '/cas/:path*',
    '/scim/:path*',
  ],
}
