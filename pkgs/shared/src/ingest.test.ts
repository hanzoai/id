/**
 * The ingest key is resolved PER HOST, and never falls back to another brand.
 *
 * The defect these pin is measured, not hypothetical: one image serves every
 * brand's identity host and it carried a single build-time key — Hanzo's — so a
 * week of lux.id, zoolabs.id, id.bootno.de, id.lux.network, osage.id,
 * id.zoo.network and pars.id traffic landed in Hanzo's project. The test that
 * matters most is the one asserting an unknown host gets NOTHING: a fallback is
 * how the original bug was silent.
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { ingestKey, keyringOf, parseKeyring } from './ingest'
import { resolveOrg, parseCatalog } from './org'

// The shape the runtime serves, trimmed to the fields these tests read. Mirrors
// infra/k8s/id/configmap.yaml in universe.
const CATALOG = parseCatalog(
  JSON.stringify({
    'hanzo.id': { orgId: 'hanzo', canonical: true, clientId: 'hanzo-console' },
    'iam.hanzo.ai': { orgId: 'hanzo', clientId: 'hanzo-console' },
    'lux.id': { orgId: 'lux', canonical: true, clientId: 'lux-cloud' },
    'id.lux.network': { orgId: 'lux', clientId: 'lux-cloud' },
    'zoolabs.id': { orgId: 'zoo', canonical: true, clientId: 'zoo-console' },
    'www.zoolabs.id': { orgId: 'zoo', clientId: 'zoo-console' },
    'id.zoo.network': { orgId: 'zoo', clientId: 'zoo-console' },
    'pars.id': { orgId: 'pars', canonical: true, clientId: 'pars-console' },
    'osage.id': { orgId: 'osage', canonical: true, clientId: 'osage-id-portal' },
    'id.bootno.de': { orgId: 'bootnode', canonical: true, clientId: 'bootnode-platform' },
  }),
)

// Stand-ins with the real shape. The live values are per-team api_tokens read
// from the insights store and stated in the ConfigMap; nothing here is a copy of
// one, and no test may ever need a real key to pass.
const KEYRING = parseKeyring(
  JSON.stringify({ hanzo: 'pk-hanzoKEY0000000000', lux: 'pk-luxKEY00000000000', zoo: 'pk-zooKEY00000000000' }),
)

/** What a browser on `host` would send: the same two calls analytics.tsx makes. */
function keyFor(host: string): string | undefined {
  return ingestKey(resolveOrg(host, { catalog: CATALOG }).orgId, KEYRING)
}

test('each brand host resolves to its OWN key, aliases included', () => {
  for (const host of ['hanzo.id', 'iam.hanzo.ai']) {
    assert.equal(keyFor(host), KEYRING.hanzo, `${host} must send Hanzo's key`)
  }
  for (const host of ['lux.id', 'id.lux.network']) {
    assert.equal(keyFor(host), KEYRING.lux, `${host} must send Lux's key`)
  }
  for (const host of ['zoolabs.id', 'www.zoolabs.id', 'id.zoo.network']) {
    assert.equal(keyFor(host), KEYRING.zoo, `${host} must send Zoo's key`)
  }
})

/**
 * The whole point. Every one of these hosts sent Hanzo's key before, and a
 * fallback of any kind here re-creates the defect exactly.
 */
test('no host ever sends another brand\'s key', () => {
  for (const host of ['lux.id', 'id.lux.network', 'zoolabs.id', 'www.zoolabs.id', 'id.zoo.network']) {
    assert.notEqual(keyFor(host), KEYRING.hanzo, `${host} must not send Hanzo's key`)
  }
  assert.notEqual(keyFor('zoolabs.id'), KEYRING.lux)
  assert.notEqual(keyFor('lux.id'), KEYRING.zoo)
})

/**
 * An org with no key reports NOTHING. pars, osage and bootnode have no project
 * of their own, and the alternative to silence is filing their sign-ins under a
 * brand that is not theirs.
 */
test('an org the keyring does not name gets no key at all', () => {
  for (const host of ['pars.id', 'osage.id', 'id.bootno.de']) {
    assert.equal(keyFor(host), undefined, `${host} names no key and must send none`)
  }
})

test('an unknown host fails closed rather than defaulting to Hanzo', () => {
  // resolveOrg gives an unregistered host a skeleton with an empty orgId.
  assert.equal(resolveOrg('id.example.test', { catalog: CATALOG }).orgId, '')
  assert.equal(keyFor('id.example.test'), undefined)
})

/**
 * A lost `/config.json` must not become a cross-brand write.
 *
 * The two halves are both correct and they differ, so both are stated. A host
 * with a BUILT-IN org (org.ts DEFAULT_TENANTS) still knows which brand it is
 * without the catalog, so it keeps its OWN key — never Hanzo's. A catalog-only
 * host has nothing left to identify it, so it reports nothing. Neither answer is
 * "Hanzo", which is the only answer that would be wrong.
 */
test('a lost catalog degrades to the host\'s own brand, or to silence', () => {
  const lost = (host: string) => ingestKey(resolveOrg(host, { catalog: {} }).orgId, KEYRING)

  // Built in: lux.id is Lux with or without the catalog.
  assert.equal(lost('lux.id'), KEYRING.lux)
  assert.equal(lost('hanzo.id'), KEYRING.hanzo)

  // Catalog-only: zoolabs.id, id.zoo.network and id.bootno.de have no built-in
  // entry, so without the catalog they resolve to an empty org and stay silent.
  for (const host of ['zoolabs.id', 'www.zoolabs.id', 'id.zoo.network', 'id.lux.network', 'id.bootno.de']) {
    assert.equal(lost(host), undefined, `${host} must go silent, not report as Hanzo`)
  }
})

test('ingestKey is total and refuses anything that is not publishable', () => {
  assert.equal(ingestKey('', KEYRING), undefined)
  assert.equal(ingestKey('lux', {}), undefined)
  // sk- is SECRET and must never reach a browser, however it got into the map.
  assert.equal(ingestKey('lux', { lux: 'sk-notpublishable0000' }), undefined)
  assert.equal(ingestKey('lux', { lux: '' }), undefined)
  assert.equal(ingestKey('lux', { lux: '   ' }), undefined)
  assert.equal(ingestKey('lux', { lux: 'hk-wrongfamily000000' }), undefined)
  // Surrounding whitespace in a hand-edited ConfigMap is not a broken key.
  assert.equal(ingestKey('lux', { lux: '  pk-fine000000000000  ' }), 'pk-fine000000000000')
  // Non-string values (a YAML number, a nested object) are not keys.
  assert.equal(ingestKey('lux', parseKeyring(JSON.stringify({ lux: 12345 }))), undefined)
  assert.equal(ingestKey('lux', parseKeyring(JSON.stringify({ lux: { key: 'pk-x' } }))), undefined)
})

/**
 * The property name is the SERVER'S. Reading the wrong one stops every host
 * reporting at once, silently — the same failure `catalogOf` exists to pin.
 */
test('keyringOf reads the name the runtime actually serves', () => {
  const served = { iamTenantConfigJson: '{}', ingestKeyring: '{"lux":"pk-x0000000000000000"}', v: 1 }
  assert.equal(keyringOf(served), '{"lux":"pk-x0000000000000000"}')
  assert.equal(keyringOf({ ingestKeys: '{"lux":"pk-x"}' }), undefined)
  assert.equal(keyringOf({}), undefined)
  assert.equal(keyringOf(null), undefined)
  assert.equal(keyringOf('a string'), undefined)
  assert.equal(keyringOf({ ingestKeyring: 42 }), undefined)
})

test('parseKeyring survives whatever the runtime hands it', () => {
  assert.deepEqual(parseKeyring(undefined), {})
  assert.deepEqual(parseKeyring(null), {})
  assert.deepEqual(parseKeyring(''), {})
  assert.deepEqual(parseKeyring('not json'), {})
  assert.deepEqual(parseKeyring('[]'), {})
  assert.deepEqual(parseKeyring('null'), {})
  assert.deepEqual(parseKeyring('{"lux":"pk-a0000000000000000"}'), { lux: 'pk-a0000000000000000' })
})
