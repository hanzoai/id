/**
 * The consent policy a brand's page asks cloud for, and what the answer decides.
 *
 * The page asks on arrival, with the brand's own key and no credential, and
 * reads only the policy: the tags cloud lists beside it are never loaded. The
 * policy is the banner's — it decides whether a stored choice still counts and
 * whether the visitor is asked. The first-party stream does not wait on it: it
 * runs for every visitor, under every policy, and when cloud is unreachable.
 */
import { afterEach, beforeEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, cleanup, render } from '@testing-library/react'
import { acceptAll, asks, readConsent } from '@hanzo/event'
import { Analytics } from './analytics'
import { newDocument, newVisitor } from './document'

const LUX = 'pk-luxKEY00000000000'
const HANZO = 'pk-hanzoKEY0000000000'

const SERVED = {
  iamTenantConfigJson: JSON.stringify({
    'hanzo.id': { orgId: 'hanzo', clientId: 'hanzo-console' },
    'lux.id': { orgId: 'lux', clientId: 'lux-cloud' },
    'pars.id': { orgId: 'pars', clientId: 'pars-console' },
  }),
  ingestKeyring: JSON.stringify({ hanzo: HANZO, lux: LUX }),
  v: 1,
}

/** cloud's answer: Google's and Meta's tags beside the policy, which must stay unloaded. */
const policy = (consent: Record<string, unknown>) => ({
  tags: [
    { platform: 'ga4', type: 'ga', id: 'G-EKBNQ969GE' },
    { platform: 'meta', type: 'meta', id: '1790308611893001' },
  ],
  consent: { region: '', mode: 'opt-in', defaults: { analytics: false, marketing: false, ads: false }, version: 1, ...consent },
  audience: 'person',
})

let asked: { url: URL; init?: RequestInit }[]
let sent: string[]
let answer: () => Response

beforeEach(() => {
  newDocument()
  asked = []
  sent = []
  answer = () => Response.json(policy({}))
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).includes('/config.json')) return Response.json(SERVED)
    if (String(url).includes('/v1/project/tags')) {
      asked.push({ url: new URL(String(url)), init })
      return answer()
    }
    sent.push(String(init?.body ?? ''))
    return Response.json({ accepted: 1 })
  })
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: (_u: string, blob: Blob) => {
      void blob.text().then((b) => sent.push(b))
      return true
    },
  })
})

afterEach(() => {
  cleanup()
  newVisitor()
  vi.unstubAllGlobals()
})

async function load(host: string) {
  ;(window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(`https://${host}/login`)
  render(
    <Analytics>
      <div>portal</div>
    </Analytics>,
  )
  await settle()
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
  })
}

/** Leaving delivers what the page holds, as a visitor's leaving does. */
async function leave() {
  await act(async () => void window.dispatchEvent(new Event('pagehide')))
  await settle()
}

/** A choice stored on this host under policy `v`. */
function stored(v: number) {
  document.cookie = "__Host-hz_consent=analytics%2Cmarketing%2Cads; Path=/; Secure"
  document.cookie = `__Host-hz_consent_v=${v}; Path=/; Secure`
}

test('a brand with no key never asks, even after Accept', async () => {
  ;(window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL('https://pars.id/login')
  acceptAll()
  await load('pars.id')
  await leave()
  assert.equal(asked.length, 0, 'pars names no key, so it asks nothing')
  assert.equal(sent.length, 0)
})

test('a brand with a key asks for its policy on arrival, with its own key and no credential, and reports', async () => {
  await load('lux.id')

  assert.equal(asked.length, 1, `one policy request — got ${asked.length}`)
  const [ask] = asked
  assert.equal(ask!.url.pathname, '/v1/project/tags')
  assert.equal(ask!.url.searchParams.get('key'), LUX)
  assert.equal(ask!.url.searchParams.get('host'), 'lux.id')
  assert.equal(ask!.init?.credentials, 'omit')
  await leave()
  assert.ok(sent.some((b) => b.includes('"$pageview"')), 'the stream runs before any choice')
})

test('Accept on the page asks for no second policy', async () => {
  await load('lux.id')
  await act(async () => acceptAll())
  await settle()
  assert.equal(asked.length, 1, `one policy request — got ${asked.length}`)
})

test('a choice stored under an older policy is undone and asked again, and the stream still runs', async () => {
  ;(window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL('https://lux.id/login')
  stored(2)
  answer = () => Response.json(policy({ version: 3 }))
  await load('lux.id')
  await leave()
  assert.equal(asked.length, 1)
  assert.equal(readConsent().analytics, false, 'the old Accept does not count under policy 3')
  assert.equal(asks(), true, 'and the banner asks again')
  assert.ok(sent.some((b) => b.includes('"$pageview"')), 'the first-party stream does not wait on the choice')
})

test('a refusal cloud saw on the request undoes the stored choice, and the stream still runs', async () => {
  ;(window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL('https://lux.id/login')
  stored(2)
  answer = () => Response.json(policy({ version: 2, refused: true }))
  await load('lux.id')
  await leave()
  assert.equal(readConsent().analytics, false)
  assert.ok(sent.some((b) => b.includes('"$pageview"')))
})

test('an unreachable cloud leaves the banner its default, and the stream still runs', async () => {
  ;(window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL('https://lux.id/login')
  answer = () => new Response('unavailable', { status: 503 })
  await load('lux.id')
  await leave()
  assert.equal(asked.length, 1)
  assert.ok(sent.some((b) => b.includes('"$pageview"')))
})
