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
 */
export function clientIdFrom(search: string, pathname: string): string | undefined {
  const fromQuery = new URLSearchParams(search).get('client_id')
  if (fromQuery) return fromQuery

  // Exactly one segment after the page, and it must look like an IAM client id
  // (`<org>-<app>`, the estate's one naming rule). Anything else — a deeper
  // path, an encoded slash, junk — resolves to undefined and the caller falls
  // back to the host default, which is the behaviour that was there before.
  const seg = pathname.split('/').filter(Boolean)
  if (seg.length !== 2) return undefined
  return /^[a-z0-9]+(-[a-z0-9]+)+$/.test(seg[1]!) ? seg[1] : undefined
}
