import { test } from 'vitest'
import assert from 'node:assert/strict'
import { localizeBrandJson } from './brand-local'

/**
 * The credential-entry path makes ZERO third-party requests: any
 * `cdn.jsdelivr.net/npm/<this pkg>@<tag>/<path>` asset URL in the served
 * brand.json is rewritten to same-origin `/brand/<slug>/<file>` whenever a
 * local file backs it, and left VERBATIM whenever none does (so a brand that
 * ships no asset still degrades to the wordmark exactly as before).
 */

const raw = JSON.stringify({
  brand: {
    name: 'Hanzo',
    logoUrl: 'https://cdn.jsdelivr.net/npm/@hanzo/brand@latest/assets/logo/logo.svg',
    faviconUrl: 'https://cdn.jsdelivr.net/npm/@hanzo/brand@latest/assets/logo/favicon.png',
  },
})

test('jsdelivr URLs with local files become flat same-origin paths', () => {
  const { json, assets } = localizeBrandJson(raw, '@hanzo/brand', 'hanzo', (rel) => `/pkg/${rel}`)
  const b = (JSON.parse(json) as { brand: Record<string, string> }).brand
  assert.equal(b.logoUrl, '/brand/hanzo/logo.svg')
  assert.equal(b.faviconUrl, '/brand/hanzo/favicon.png')
  assert.equal(assets.get('brand/hanzo/logo.svg'), '/pkg/assets/logo/logo.svg')
  assert.equal(assets.get('brand/hanzo/favicon.png'), '/pkg/assets/logo/favicon.png')
  assert.ok(!json.includes('jsdelivr'), 'no third-party URL survives when local files exist')
})

test('a URL with no local file stays verbatim — fallback behavior unchanged', () => {
  const { json, assets } = localizeBrandJson(raw, '@hanzo/brand', 'hanzo', (rel) =>
    rel.endsWith('logo.svg') ? `/pkg/${rel}` : null,
  )
  const b = (JSON.parse(json) as { brand: Record<string, string> }).brand
  assert.equal(b.logoUrl, '/brand/hanzo/logo.svg')
  assert.equal(b.faviconUrl, 'https://cdn.jsdelivr.net/npm/@hanzo/brand@latest/assets/logo/favicon.png')
  assert.equal(assets.size, 1)
})

test("another package's jsdelivr URL and non-jsdelivr URLs are untouched", () => {
  const other = JSON.stringify({
    brand: {
      logoUrl: 'https://cdn.jsdelivr.net/npm/@zooai/brand@latest/assets/logo/logo.svg',
      faviconUrl: '/favicon.svg',
    },
  })
  const { json, assets } = localizeBrandJson(other, '@hanzo/brand', 'hanzo', () => '/pkg/anything')
  const b = (JSON.parse(json) as { brand: Record<string, string> }).brand
  assert.equal(b.logoUrl, 'https://cdn.jsdelivr.net/npm/@zooai/brand@latest/assets/logo/logo.svg')
  assert.equal(b.faviconUrl, '/favicon.svg')
  assert.equal(assets.size, 0)
})

test('every non-asset brand field rides through byte-identical', () => {
  const { json } = localizeBrandJson(raw, '@hanzo/brand', 'hanzo', () => null)
  assert.deepEqual(JSON.parse(json), JSON.parse(raw))
})
