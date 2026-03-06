/**
 * Server-side logout handler.
 *
 * Calls IAM to invalidate the session, clears cookies,
 * and redirects to the login page.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getIamUrl } from '@/lib/iam'

export const runtime = 'edge'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const host = url.hostname
  const iamOrigin = getIamUrl(host)
  const iamHost = new URL(iamOrigin).host

  const idTokenHint = url.searchParams.get('id_token_hint') || ''
  const postLogoutRedirectUri = url.searchParams.get('post_logout_redirect_uri') || `${url.origin}/login?prompt=login`
  const state = url.searchParams.get('state') || ''

  // Call IAM logout
  const logoutUrl = new URL('/api/logout', iamOrigin)
  logoutUrl.searchParams.set('id_token_hint', idTokenHint)
  logoutUrl.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri)
  logoutUrl.searchParams.set('state', state)

  try {
    await fetch(logoutUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Host': iamHost,
      },
    })
  } catch {}

  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: '/login?prompt=login',
      'Set-Cookie': 'iam_session_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax',
    },
  })
}

export async function POST(request: NextRequest) {
  return GET(request)
}
