/**
 * `/config.json` is fetched once and read the same way by both of its readers.
 *
 * The shell asks it which brand a host is; telemetry asks it which key that
 * brand writes with. If those two ever answered from different requests, a page
 * could render as one brand and report as another — which is the exact failure
 * class this whole change removes.
 */
import { test, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import { loadRuntime, resetRuntime } from './runtime'
import { ingestKey } from './ingest'
import { resolveOrg } from './org'

const SERVED = {
  iamTenantConfigJson: JSON.stringify({ 'lux.id': { orgId: 'lux', clientId: 'lux-cloud' } }),
  ingestKeyring: JSON.stringify({ lux: 'pk-luxKEY00000000000' }),
  v: 1,
}

/** Installs a fetch that counts its calls and answers `payload`. */
function serve(payload: unknown, ok = true) {
  const calls = { n: 0 }
  ;(globalThis as { fetch?: unknown }).fetch = async (url: string) => {
    calls.n++
    assert.equal(url, '/config.json')
    return { ok, json: async () => payload } as unknown as Response
  }
  return calls
}

afterEach(() => {
  resetRuntime()
  delete (globalThis as { fetch?: unknown }).fetch
  delete (globalThis as { __ID_CATALOG__?: string }).__ID_CATALOG__
})

test('both readers resolve from ONE request', async () => {
  const calls = serve(SERVED)

  const a = await loadRuntime()
  const b = await loadRuntime()

  assert.equal(calls.n, 1, 'the payload is fetched once per document')
  assert.equal(resolveOrg('lux.id', { catalog: a.catalog }).orgId, 'lux')
  assert.equal(ingestKey('lux', b.keyring), 'pk-luxKEY00000000000')
})

test('a failed fetch leaves every host unknown, so nothing reports', async () => {
  ;(globalThis as { fetch?: unknown }).fetch = async () => {
    throw new Error('offline')
  }
  const rt = await loadRuntime()
  assert.deepEqual(rt.keyring, {})
  assert.equal(ingestKey(resolveOrg('lux.id', { catalog: rt.catalog }).orgId, rt.keyring), undefined)
})

test('a non-ok response is not a payload', async () => {
  serve(SERVED, false)
  const rt = await loadRuntime()
  assert.deepEqual(rt.catalog, {})
  assert.deepEqual(rt.keyring, {})
})

/**
 * The catalog keeps its legacy global fallback; the keyring has none. Two
 * sources for "which tenant does this page write into" is one source too many,
 * and an injected global is the one an attacker could reach.
 */
test('the catalog may come from the legacy global; a key never can', async () => {
  serve({ v: 1 }) // served payload carries neither key
  ;(globalThis as { __ID_CATALOG__?: string }).__ID_CATALOG__ = JSON.stringify({
    'lux.id': { orgId: 'lux' },
  })
  const rt = await loadRuntime()
  assert.equal(resolveOrg('lux.id', { catalog: rt.catalog }).orgId, 'lux')
  assert.deepEqual(rt.keyring, {})
})
