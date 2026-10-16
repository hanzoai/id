// A new document, for a suite that visits several in one file. Tests only — a
// browser never needs this, because a page loads once.
//
// A browser gives each document its own realm, so whatever a page keeps for its
// lifetime starts empty on the next one. A test file is ONE realm for all of its
// tests, and the suites here visit many documents in it — lux.id, then hanzo.id.
// What lives as long as the page has to be dropped by hand, or the second
// document inherits the first one's. Two things on this surface live that long:
//
//   - the `/config.json` memo (`loadRuntime`, once per document);
//   - @hanzo/event's clients. `createAnalytics` returns the page's client for a
//     stream, and every later caller is handed it with the FIRST caller's key,
//     transport and identity. On a page that is the point: one host, one key.
//     Across test documents it is how hanzo.id reported on Lux's key.
import { rejectAll, resetClients, serveConsent } from '@hanzo/event'
import { resetRuntime } from '@hanzo/id-shared'

export function newDocument(): void {
  resetRuntime()
  resetClients()
}

/**
 * A visitor who has not chosen: what @hanzo/event stored for the last one is
 * withdrawn (a refusal forgets every id and touch it wrote), the choice itself
 * is expired under whichever name the page's protocol gave it, and the policy
 * cloud served the last document is dropped.
 */
export function newVisitor(): void {
  rejectAll()
  serveConsent(null)
  for (const name of ['hz_consent', 'hz_consent_v', '__Host-hz_consent', '__Host-hz_consent_v']) {
    document.cookie = `${name}=; Max-Age=0; Path=/; Secure`
  }
}
