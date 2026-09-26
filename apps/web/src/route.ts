/**
 * Which application a visitor arrived FOR.
 *
 * Two shapes reach these pages and both are deliberate:
 *
 *   /signup?client_id=hanzo-chat      the OAuth shape, carrying the whole
 *                                     request (redirect_uri, state, PKCE)
 *   /signup/hanzo-chat                the plain-link shape, for a marketing
 *                                     "Sign up" that starts no OAuth request
 *
 * `App.tsx` has always routed the second one — `path.startsWith('/signup/')`
 * and `'/login/'` are in its switch — so the shape is accepted by design. The
 * PAGES then read only `?client_id`, so the segment was matched and thrown
 * away: hanzo.chat links to `hanzo.id/signup/hanzo-chat` from three components,
 * and every one of them landed on a page that had silently fallen back to the
 * host's default app. An account created there belongs to a different
 * application than the button that asked for it.
 *
 * Query wins when both are present: it is the OAuth request, and it is the one
 * that carries a redirect_uri to return through.
 *
 * Links between the two pages keep the shape they arrived in — see
 * {@link signupHref} and {@link signinHref}.
 */
export function clientIdFrom(search: string, pathname: string): string | undefined {
  const fromQuery = new URLSearchParams(search).get('client_id')
  if (fromQuery) return fromQuery
  return segmentOf(pathname)
}

/**
 * The client named by the plain-link shape's path segment, or undefined.
 *
 * Exactly one segment after the page, and it must look like an IAM client id
 * (`<org>-<app>`, the estate's one naming rule). Anything else — a deeper path,
 * an encoded slash, junk — resolves to undefined and the caller falls back to
 * the host default.
 */
function segmentOf(pathname: string): string | undefined {
  const seg = pathname.split('/').filter(Boolean)
  if (seg.length !== 2) return undefined
  return /^[a-z0-9]+(-[a-z0-9]+)+$/.test(seg[1]!) ? seg[1] : undefined
}

/**
 * The registration page for the request this page was handed.
 *
 * The query travels verbatim: client_id, redirect_uri, state, nonce and the PKCE
 * challenge are what let registration return the new account to the app that
 * asked, and anything else an app sent rides with them. The plain-link shape
 * keeps its segment, `/login/hanzo-chat` -> `/signup/hanzo-chat`, since that
 * segment is the only thing naming the application there.
 */
export function signupHref(pathname: string, search: string): string {
  const seg = segmentOf(pathname)
  return `/signup${seg ? `/${seg}` : ''}${search}`
}

/**
 * The sign-in page for the request this page was handed; the reverse of
 * {@link signupHref}.
 *
 * Every parameter travels except the registration hint. `/login` answers
 * `signup=true` and `screen_hint=signup` by forwarding straight back here, so
 * carrying either would turn "Sign in" into a loop onto this page.
 */
export function signinHref(pathname: string, search: string): string {
  const seg = segmentOf(pathname)
  const q = new URLSearchParams(search)
  q.delete('signup')
  if (q.get('screen_hint') === 'signup') q.delete('screen_hint')
  const rest = q.toString()
  return `/login${seg ? `/${seg}` : ''}${rest ? `?${rest}` : ''}`
}

/**
 * The address a page starts its identifier field with, from `login_hint`.
 *
 * IAM forwards the hint an application named, and registration sends the address
 * it found already taken. A subject (a UUID, or owner/name) names an account but
 * is nothing a person types, so it starts the field empty.
 */
export function hintFrom(search: string): string | undefined {
  const hint = new URLSearchParams(search).get('login_hint') ?? ''
  return hint && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(hint) && !hint.includes('/') ? hint : undefined
}
