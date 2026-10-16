/**
 * Which tag set a brand's page asks for, and when.
 *
 * The tag manager asks cloud once per document for the tag set of the project
 * the key names (`GET /v1/project/tags?key=`), and loads only what that set
 * holds. So the key on that one request decides whose GA4 and whose pixels a
 * brand's visitors load — Lux's page must name Lux's key, and a brand with no
 * key must not ask at all, or it would be served the set a bare host resolves to.
 *
 * The tag manager keeps its state for the life of the document (one request per
 * page), and a test file is one document, so the cases run in order and only the
 * last one is allowed to ask.
 */
import { afterEach, beforeEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, cleanup, render } from '@testing-library/react'
import { acceptAll } from '@hanzo/event'
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

let tagged: URL[]

beforeEach(() => {
  newDocument()
  tagged = []
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url).includes('/config.json')) return { ok: true, json: async () => SERVED } as unknown as Response
    if (String(url).includes('/v1/project/tags')) {
      tagged.push(new URL(String(url)))
      return { ok: true, json: async () => ({ tags: [], audience: 'person' }) } as unknown as Response
    }
    return { ok: true, status: 200, text: async () => '{}' } as unknown as Response
  })
  Object.defineProperty(navigator, 'sendBeacon', { value: () => true, configurable: true })
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
    for (let i = 0; i < 4; i++) await Promise.resolve()
  })
}

test('a brand with no key never asks for a tag set, even after Accept', async () => {
  acceptAll()
  await load('pars.id')
  await settle()
  assert.equal(tagged.length, 0, 'pars names no key, so it starts no tags')
})

test('a brand with a key asks nothing before the visitor chooses', async () => {
  await load('lux.id')
  assert.equal(tagged.length, 0)
})

test('after Accept, Lux asks for its own tag set with its own key, once', async () => {
  await load('lux.id')
  await act(async () => acceptAll())
  await settle()

  assert.equal(tagged.length, 1, `one tag-config request — got ${tagged.length}`)
  const [ask] = tagged
  assert.equal(ask!.pathname, '/v1/project/tags')
  assert.equal(ask!.searchParams.get('key'), LUX)
  assert.equal(ask!.searchParams.get('host'), 'lux.id')
  assert.notEqual(ask!.searchParams.get('key'), HANZO)
})
