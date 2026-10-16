/**
 * What the mounted portal actually puts on the wire: which key, and how many
 * times.
 *
 * The unit tests around `ingestKey` prove the resolver picks the right key. They
 * cannot see either of the two defects that reached production, because both are
 * properties of the MOUNTED component rather than of a pure function:
 *
 *   - the key that ships is the one for the host the document was served on. The
 *     original defect was a key chosen at build time, which no resolver test can
 *     catch because there was no resolver.
 *   - a document is counted ONCE. The first fix duplicated every pageview:
 *     handing the provider a live client after mount changes `usePageview`'s
 *     dependency, and that hook suppresses only its first run, so an
 *     already-mounted copy fired on top of the provider's own initial pageview.
 *     Every assertion about keys passed while the counts were doubled.
 *
 * So this asserts on the REQUESTS, not on the component — and on the visitor's
 * choice, which decides whether there are any: nothing before it, nothing after
 * a refusal, nothing from a browser that sends Global Privacy Control.
 */
import { afterEach, beforeEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, cleanup, render } from '@testing-library/react'
import { acceptAll, rejectAll } from '@hanzo/event'
import { Analytics } from './analytics'
import { newDocument, newVisitor } from './document'

const LUX = 'pk-luxKEY00000000000'
const HANZO = 'pk-hanzoKEY0000000000'

const SERVED = {
  iamTenantConfigJson: JSON.stringify({
    'hanzo.id': { orgId: 'hanzo', clientId: 'hanzo-console' },
    'lux.id': { orgId: 'lux', clientId: 'lux-cloud' },
    'osage.id': { orgId: 'osage', clientId: 'osage-id-portal' },
  }),
  ingestKeyring: JSON.stringify({ hanzo: HANZO, lux: LUX }),
  v: 1,
}

interface Beacon {
  readonly key: string | undefined
  readonly events: readonly { event?: string; properties?: Record<string, unknown> }[]
}

let sent: Beacon[]
let pendingBodies: Promise<void>[]
/** Every tag-config request the tag manager made, as its URL. */
let tagged: URL[]

/** cloud's answer to a tag-config request: no tags, and the policy it serves. */
const TAGS = {
  tags: [],
  consent: { region: '', mode: 'opt-in', defaults: { analytics: false, marketing: false, ads: false }, gpc: false, version: 1 },
  audience: 'person',
}

/** Serves /config.json and the tag config, and records every ingest POST, on either transport. */
function wire() {
  sent = []
  pendingBodies = []
  tagged = []
  const record = (body: string, key: string | undefined) => {
    const parsed = JSON.parse(body) as { batch?: Beacon['events'] }
    sent.push({ key, events: parsed.batch ?? [] })
  }
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).includes('/config.json')) {
      return { ok: true, json: async () => SERVED } as unknown as Response
    }
    if (String(url).includes('/v1/project/tags')) {
      tagged.push(new URL(String(url)))
      return { ok: true, json: async () => TAGS } as unknown as Response
    }
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization
    record(String(init?.body ?? '{}'), auth?.replace(/^Bearer /, ''))
    return { ok: true, status: 200, text: async () => '{}' } as unknown as Response
  })
  // sendBeacon is the transport the client prefers, and it carries the key in the
  // query because a beacon cannot set headers.
  const sendBeacon = (url: string, blob: Blob) => {
    const key = new URL(String(url), 'https://x.test').searchParams.get('ingest_key') ?? undefined
    pendingBodies.push(blob.text().then((b) => record(b, key)))
    return true
  }
  Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true })
}

/**
 * Mounts the portal at `host` and delivers what the document would send.
 *
 * `pagehide` is how a real document flushes — the client registers it in init()
 * and flushes immediately — so driving it here is the delivery a visitor causes
 * by leaving, not a test-only hook. Waiting out the 5s batch timer instead would
 * test the same bytes five seconds slower.
 */
async function visit(host: string, path = '/login', choice: 'accepted' | 'refused' | 'none' = 'accepted') {
  // The document's own address is the input under test, so the test environment
  // has to be moved rather than the component told where it is.
  ;(window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(`https://${host}${path}`)
  // A returning visitor's choice, stored before this document loaded.
  if (choice === 'accepted') acceptAll()
  if (choice === 'refused') rejectAll()
  render(
    <Analytics>
      <div>portal</div>
    </Analytics>,
  )
  // Let /config.json resolve and the live client reach the provider.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  await act(async () => {
    window.dispatchEvent(new Event('pagehide'))
  })
  await Promise.all(pendingBodies)
}

/**
 * Every $pageview EVENT that reached the wire, each with the key it rode on.
 *
 * Counted per event rather than per request, because the two duplicates do not
 * always arrive as two requests — batched, they are one POST carrying the
 * pageview twice, and a per-request count reads that as correct.
 */
function pageviews(): { key: string | undefined }[] {
  return sent.flatMap((b) => b.events.filter((e) => e.event === '$pageview').map(() => ({ key: b.key })))
}

beforeEach(() => {
  newDocument()
  wire()
})

afterEach(() => {
  cleanup()
  newVisitor()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('a Lux host reports with LUX\'s key, exactly once', async () => {
  await visit('lux.id')

  const views = pageviews()
  assert.equal(views.length, 1, `one document, one pageview — got ${views.length}`)
  assert.equal(views[0]!.key, LUX)
})

test('a Hanzo host reports with HANZO\'s key, exactly once', async () => {
  await visit('hanzo.id')

  const views = pageviews()
  assert.equal(views.length, 1, `one document, one pageview — got ${views.length}`)
  assert.equal(views[0]!.key, HANZO)
})

/**
 * The defect this whole change removes, asserted on the wire: no host may ever
 * put another brand's key on a request.
 */
test('a Lux host never puts Hanzo\'s key on the wire', async () => {
  await visit('lux.id')
  for (const b of sent) assert.notEqual(b.key, HANZO)
})

test('an org with no key reports nothing at all', async () => {
  await visit('osage.id')
  assert.equal(sent.length, 0, 'osage names no key, so nothing may be sent')
})

test('an unknown host reports nothing rather than defaulting to Hanzo', async () => {
  await visit('id.example.test')
  assert.equal(sent.length, 0)
})

test('a route carrying a credential emits nothing, whatever the brand', async () => {
  await visit('lux.id', '/callback?code=AUTHCODE_abc&state=STATE_def')
  assert.equal(sent.length, 0, '/callback must never emit — the code is in the URL')
})

test('a browser sending Global Privacy Control emits nothing, even over a stored Accept', async () => {
  Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true })
  try {
    await visit('lux.id')
    assert.equal(sent.length, 0)
    assert.equal(tagged.length, 0, 'not even the tag config is asked for')
  } finally {
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: undefined, configurable: true })
  }
})

test('a browser sending Do Not Track emits nothing', async () => {
  Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true })
  try {
    await visit('hanzo.id')
    assert.equal(sent.length, 0)
    assert.equal(tagged.length, 0)
  } finally {
    Object.defineProperty(navigator, 'doNotTrack', { value: null, configurable: true })
  }
})

test('before the visitor chooses, nothing is sent and no tag config is asked for', async () => {
  await visit('hanzo.id', '/login', 'none')
  assert.equal(sent.length, 0, 'no event before a choice — not a pageview, not an error')
  assert.equal(tagged.length, 0)
  assert.equal(document.cookie.includes('iam-anon-id'), false, 'and no visitor id is kept')
})

test('a visitor who refused sends nothing', async () => {
  await visit('lux.id', '/login', 'refused')
  assert.equal(sent.length, 0)
  assert.equal(tagged.length, 0)
})

test('Accept on the page starts the stream there, with the arrival counted once', async () => {
  await visit('lux.id', '/login', 'none')
  assert.equal(sent.length, 0)
  await act(async () => acceptAll())
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  await act(async () => void window.dispatchEvent(new Event('pagehide')))
  await Promise.all(pendingBodies)

  const views = pageviews()
  assert.equal(views.length, 1, `one document, one pageview — got ${views.length}`)
  assert.equal(views[0]!.key, LUX)
})
