/**
 * Google account detection — One Tap as an ACCELERATOR for the existing hop.
 *
 * Google Identity Services shows the user the Google account their browser is
 * already signed in to, in Google's own card. Selecting it here does exactly
 * what pressing "Continue with Google" does: it starts IAM federation
 * (`social.ts`). Nothing else. So the fast path and the button are ONE path,
 * and the only thing One Tap buys is that the user sees WHICH account they are
 * about to use before they commit to a redirect.
 *
 * WHY THE CREDENTIAL IS THROWN AWAY. GIS hands its callback a Google ID token.
 * There is nowhere to send it: IAM federates by NAME — the browser names a
 * provider on `/v1/iam/oauth/authorize` and IAM runs the whole IdP leg
 * server-side, holding the client secret a browser cannot (see `social.ts`).
 * IAM has no endpoint that accepts a raw provider token or code, by design, and
 * inventing one here would be a second sign-in path — a custom auth flow — for a
 * provider that already has a working one. So `onSelect` takes no argument: the
 * token is not read, not decoded, not stored, and not transmitted. It is
 * discarded with the GIS callback frame.
 *
 * That makes this module strictly a UI affordance. Sign-in security is entirely
 * IAM's: the account this returns is a HINT about which button to press, never
 * an assertion of identity, and a forged credential here can do nothing but
 * start a federation hop the user could have started by clicking.
 *
 * EVERY failure is silent and safe. A blocked script, an unreachable Google, a
 * CSP that forbids the frame, a user with no Google session, a browser that
 * suppresses the prompt after repeated dismissals — all end with no card and the
 * ordinary buttons untouched. There is no state to leave behind and no error to
 * show, because nothing the user asked for has failed.
 */

/** The slice of the GIS global this module uses. */
interface GsiId {
  initialize(config: {
    client_id: string
    callback: (res: { credential?: string }) => void
    auto_select?: boolean
    cancel_on_tap_outside?: boolean
    color_scheme?: 'light' | 'dark' | 'default'
  }): void
  prompt(): void
  cancel(): void
}

interface GsiWindow {
  google?: { accounts?: { id?: GsiId } }
}

const SRC = 'https://accounts.google.com/gsi/client'

/** One in-flight load, shared by every caller; `null` once it has failed. */
let loading: Promise<GsiId | null> | null = null

/**
 * Load the GIS library once and resolve its `google.accounts.id`, or `null` if
 * it cannot be reached. Resolves rather than rejects: a missing Google is an
 * ordinary outcome here, not an error anyone can act on.
 */
function load(): Promise<GsiId | null> {
  if (loading) return loading
  loading = new Promise<GsiId | null>((resolve) => {
    const w = window as unknown as GsiWindow
    const ready = w.google?.accounts?.id
    if (ready) return resolve(ready)
    let el = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`)
    if (!el) {
      el = document.createElement('script')
      el.src = SRC
      el.async = true
      document.head.appendChild(el)
    }
    el.addEventListener('load', () => resolve((window as unknown as GsiWindow).google?.accounts?.id ?? null))
    el.addEventListener('error', () => resolve(null))
  })
  return loading
}

/**
 * The colour scheme to paint the card in — the PORTAL's, not the system's.
 *
 * GIS defaults `color_scheme` to the user's system preference, which is the
 * wrong signal: this portal declares its own scheme in CSS (`:root {
 * color-scheme: dark }` in `app.css`), so a light-mode OS would otherwise get a
 * white Google card on the dark sign-in page. Reading the RESOLVED value keeps
 * the two in step by construction — if the portal ever gains a light theme or a
 * toggle, the card follows it with no change here. `'default'` hands the choice
 * back to Google when the portal expresses no preference (`normal`), or when it
 * accepts both (`light dark`) and so has no single answer to give.
 */
function colorScheme(): 'light' | 'dark' | 'default' {
  try {
    const declared = getComputedStyle(document.documentElement).colorScheme.trim()
    if (declared === 'dark') return 'dark'
    if (declared === 'light') return 'light'
  } catch {
    /* no computed style (jsdom, detached document) → let Google decide */
  }
  return 'default'
}

export interface OneTapOptions {
  /**
   * The Google OAuth client id — read from IAM's `get-app-login`
   * (`AppProvider.clientId`), never hardcoded, so the account the card offers is
   * an account for the SAME Google client IAM will federate against. A second
   * client id here would show the user an account that the subsequent hop then
   * re-prompts for.
   */
  readonly clientId: string
  /**
   * Run the Google sign-in the user just chose. Takes NO credential: see the
   * module comment. In practice this is the same `hop(provider)` the
   * "Continue with Google" button runs.
   */
  readonly onSelect: () => void
}

/**
 * Show the Google account card, if there is one to show.
 *
 * Returns a cancel function; call it on unmount so the card cannot outlive the
 * sign-in page or fire `onSelect` into a component that is gone. Safe to call
 * whether or not the prompt ever appeared.
 */
export function startOneTap({ clientId, onSelect }: OneTapOptions): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  if (!clientId) return () => {}

  let cancelled = false
  let id: GsiId | null = null

  void load()
    .then((gsi) => {
      if (!gsi || cancelled) return
      id = gsi
      gsi.initialize({
        client_id: clientId,
        // The whole point: no auto sign-in. `auto_select` would redirect a user
        // who came here to read the page, or to use a DIFFERENT account, before
        // they touched anything. Detection is an offer, not a decision.
        auto_select: false,
        // A click into the password field must not destroy the offer — the card
        // carries its own dismiss control for a user who does not want it.
        cancel_on_tap_outside: false,
        color_scheme: colorScheme(),
        callback: () => {
          if (cancelled) return
          onSelect()
        },
      })
      gsi.prompt()
    })
    .catch(() => {
      /* no card; the ordinary buttons are already on screen */
    })

  return () => {
    cancelled = true
    try {
      id?.cancel()
    } catch {
      /* already gone */
    }
  }
}
