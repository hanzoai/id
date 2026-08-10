/**
 * Org-resolver tests — run with the Node built-in runner + native TS strip:
 *
 *   pnpm --filter @hanzo/id-shared test
 *
 * Focus: a host that exists ONLY in the runtime catalog (no built-in entry)
 * must resolve to ITS OWN brand and issuer — never inherit Hanzo's. This is the
 * osage.id brand-leak regression: the catalog carries `brandUrl`, and the
 * resolver must map it to `brandPackage` and derive issuer/origin from the host.
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { resolveOrg, parseCatalog, catalogOf, frontDoor, aliasRedirect } from './org.ts'

// Mirrors the K8s ConfigMap shape: entries carry `brandUrl`, not `brandPackage`.
const CATALOG = {
  'lux.id': {
    orgId: 'lux',
    clientId: 'lux-cloud',
    appName: 'lux-cloud',
    brandUrl: 'https://cdn.jsdelivr.net/npm/@luxfi/brand@latest/brand.json',
  },
  'osage.id': {
    orgId: 'osage',
    clientId: 'osage-id-portal',
    appName: 'osage-id',
    brandUrl: 'https://cdn.jsdelivr.net/npm/@osage/brand@latest/brand.json',
  },
  // No brandUrl on purpose — no bootnode brand package is published. This is
  // the shape that must NOT fall back to Hanzo.
  'id.bootno.de': {
    orgId: 'bootnode',
    clientId: 'bootnode-platform',
    appName: 'bootnode-platform',
  },
}

test('a built-in host resolves to its own brand with no catalog', () => {
  const t = resolveOrg('hanzo.id')
  assert.equal(t.orgId, 'hanzo')
  assert.equal(t.brandPackage, '@hanzo/brand')
  assert.equal(t.iamUrl, 'https://hanzo.id')
})

test('a catalog entry overrides clientId/appName but keeps a consistent brand', () => {
  const t = resolveOrg('lux.id', { catalog: CATALOG })
  assert.equal(t.orgId, 'lux')
  assert.equal(t.clientId, 'lux-cloud')
  assert.equal(t.brandPackage, '@luxfi/brand')
  assert.equal(t.iamUrl, 'https://lux.id')
  assert.equal(t.publicOrigin, 'https://lux.id')
})

test('a catalog-ONLY host does NOT leak the Hanzo brand (osage.id regression)', () => {
  const t = resolveOrg('osage.id', { catalog: CATALOG })
  assert.equal(t.orgId, 'osage')
  assert.equal(t.clientId, 'osage-id-portal')
  // brandUrl is mapped onto brandPackage, and it is NOT Hanzo's.
  assert.equal(t.brandPackage, '@osage/brand')
  assert.notEqual(t.brandPackage, '@hanzo/brand')
  // issuer + origin are the host itself, never hanzo.id.
  assert.equal(t.iamUrl, 'https://osage.id')
  assert.equal(t.iamIssuer, 'https://osage.id')
  assert.equal(t.publicOrigin, 'https://osage.id')
})

test('a catalog host with NO brandUrl still does not leak Hanzo (id.bootno.de)', () => {
  const t = resolveOrg('id.bootno.de', { catalog: CATALOG })
  assert.equal(t.orgId, 'bootnode')
  assert.equal(t.clientId, 'bootnode-platform')
  // The interesting case: no brandUrl at all. It must resolve EMPTY so the
  // loader shows a neutral wordmark — never another brand's mark. Before this
  // host was in the catalog it fell through to the `hanzo` default and the page
  // read "Sign in to Hanzo ID" on a Bootnode surface.
  assert.equal(t.brandPackage, '')
  assert.notEqual(t.brandPackage, '@hanzo/brand')
  // issuer + origin derive from the host itself, never hanzo.id.
  assert.equal(t.iamUrl, 'https://id.bootno.de')
  assert.equal(t.iamIssuer, 'https://id.bootno.de')
  assert.equal(t.publicOrigin, 'https://id.bootno.de')
})

test('an unknown host FAILS CLOSED — it never inherits another brand', () => {
  const t = resolveOrg('totally-unregistered.example', { catalog: CATALOG })
  // Was: DEFAULT_TENANTS['hanzo.id'] — orgId hanzo, @hanzo/brand, and
  // iamUrl https://hanzo.id. Empty clientId means the portal refuses rather
  // than authenticating as some other brand's IAM application.
  assert.equal(t.orgId, '')
  assert.equal(t.clientId, '')
  assert.equal(t.brandPackage, '')
  assert.equal(t.iamUrl, 'https://totally-unregistered.example')
  assert.notEqual(t.iamUrl, 'https://hanzo.id')
})

test('a catalog host with a FAILED catalog fetch does not leak Hanzo', () => {
  // The live failure mode: App.tsx tolerates a failed /config.json, so these
  // real hosts resolve with NO catalog at all. Every one of them used to come
  // back as Hanzo — same brand, same mark, and credentials posted at hanzo.id.
  for (const host of [
    'zoolabs.id',
    'www.zoolabs.id',
    'id.zoo.network',
    'id.lux.network',
    'iam.lux.network',
    'id.pars.network',
    'id.bootno.de',
  ]) {
    const t = resolveOrg(host) // no catalog — the fetch failed
    assert.notEqual(t.orgId, 'hanzo', `${host} leaked orgId hanzo`)
    assert.notEqual(t.brandPackage, '@hanzo/brand', `${host} leaked the Hanzo mark`)
    assert.notEqual(t.iamUrl, 'https://hanzo.id', `${host} would post credentials at hanzo.id`)
    assert.equal(t.iamUrl, `https://${host}`)
    assert.equal(t.iamIssuer, `https://${host}`)
  }
})

test('zoo.id is gone — it is NXDOMAIN and must not be a built-in', () => {
  const t = resolveOrg('zoo.id')
  assert.equal(t.orgId, '')
  assert.equal(t.clientId, '')
})

test('pars built-in uses the working pars-console portal app (not the missing pars-id)', () => {
  const t = resolveOrg('pars.id')
  assert.equal(t.clientId, 'pars-console')
  assert.equal(t.brandPackage, '@parsdao/brand')
})

test('osage built-in resolves to Osage even with NO catalog (fallback safety)', () => {
  const t = resolveOrg('osage.id')
  assert.equal(t.orgId, 'osage')
  assert.equal(t.brandPackage, '@osage/brand')
  assert.notEqual(t.brandPackage, '@hanzo/brand')
  assert.equal(t.iamUrl, 'https://osage.id')
})

test('an unknown host keeps its own origin AND does not inherit an org', () => {
  const t = resolveOrg('preview.example.com')
  // This assertion used to be `orgId === 'hanzo'` — it pinned the cross-brand
  // fallback as intended behaviour. Keeping its own origin is right; being
  // handed Hanzo's org, mark and issuer is the defect that shipped behind it.
  assert.equal(t.orgId, '')
  assert.equal(t.publicOrigin, 'https://preview.example.com')
})

test('parseCatalog tolerates junk', () => {
  assert.deepEqual(parseCatalog(undefined), {})
  assert.deepEqual(parseCatalog(null), {})
  assert.deepEqual(parseCatalog('not json'), {})
  assert.deepEqual(parseCatalog('{"osage.id":{"orgId":"osage"}}'), {
    'osage.id': { orgId: 'osage' },
  })
})

/**
 * THE FRONT DOOR, and why it is data rather than a guess.
 *
 * An org answers on several hostnames; one of them is where its people sign in.
 * That is a fact about the ORG, and the catalog is keyed by HOST, so exactly one
 * entry per org carries `canonical: true` and every other host for that org
 * redirects to it.
 *
 * What stood here was a scan of DEFAULT_TENANTS for a host ending in `.id`,
 * which answered correctly for hanzo, lux and pars and returned NOTHING for zoo
 * — whose front door is `zoolabs.id` and which has no DEFAULT_TENANTS entry at
 * all. A rule that is silently a no-op for one brand in five is the shape of bug
 * worth a test of its own, so zoo is in this table deliberately.
 */
test('the front door is read per org, including brands with no built-in row', () => {
  const catalog = parseCatalog(
    JSON.stringify({
      'hanzo.id': { orgId: 'hanzo', canonical: true },
      'iam.hanzo.ai': { orgId: 'hanzo' },
      'lux.id': { orgId: 'lux', canonical: true },
      'iam.lux.network': { orgId: 'lux' },
      'zoolabs.id': { orgId: 'zoo', canonical: true },
      'id.zoo.network': { orgId: 'zoo' },
    }),
  )

  assert.equal(frontDoor(catalog, 'hanzo'), 'https://hanzo.id')
  assert.equal(frontDoor(catalog, 'lux'), 'https://lux.id')
  // zoo is the case the old derivation could not answer.
  assert.equal(frontDoor(catalog, 'zoo'), 'https://zoolabs.id')
  // An org that names no front door stays where it is.
  assert.equal(frontDoor(catalog, 'bootnode'), '')
  assert.equal(frontDoor(catalog, ''), '')
})

test('an alias redirects to the front door, carrying path and query', () => {
  const catalog = parseCatalog(
    JSON.stringify({
      'lux.id': { orgId: 'lux', canonical: true },
      'iam.lux.network': { orgId: 'lux' },
    }),
  )

  // The whole OAuth request travels — dropping it would strand the app that
  // sent the visitor here.
  assert.equal(
    aliasRedirect(catalog, 'lux', 'https://iam.lux.network', '/login/oauth/authorize', '?client_id=lux-cloud&state=s'),
    'https://lux.id/login/oauth/authorize?client_id=lux-cloud&state=s',
  )
  assert.equal(aliasRedirect(catalog, 'lux', 'https://iam.lux.network', '/', ''), 'https://lux.id/')
})

// The two ways this could loop or break a live flow, pinned.
test('the front door and /callback never redirect', () => {
  const catalog = parseCatalog(
    JSON.stringify({
      'lux.id': { orgId: 'lux', canonical: true },
      'iam.lux.network': { orgId: 'lux' },
    }),
  )

  // Self-redirect is what a loop is made of.
  assert.equal(aliasRedirect(catalog, 'lux', 'https://lux.id', '/login', '?a=1'), null)
  assert.equal(aliasRedirect(catalog, 'lux', 'https://lux.id/', '/login', ''), null)

  // A provider returns to the exact URI it was given; moving that page would
  // discard the code mid-exchange.
  assert.equal(aliasRedirect(catalog, 'lux', 'https://iam.lux.network', '/callback', '?code=abc'), null)
  assert.equal(aliasRedirect(catalog, 'lux', 'https://iam.lux.network', '/callback/github', '?code=abc'), null)

  // No front door declared: every host stays put.
  const single = parseCatalog(JSON.stringify({ 'id.bootno.de': { orgId: 'bootnode' } }))
  assert.equal(aliasRedirect(single, 'bootnode', 'https://id.bootno.de', '/login', ''), null)
})

// The catalog key is the SERVER'S name. Reading the wrong one returns undefined,
// the app falls back to a global the runtime never injects, and every
// catalog-only host silently drops to the bundled defaults — a total catalog
// outage that looks like nothing at all. Pinned here, next to the resolver it
// feeds, because the last time these tests were deleted the function went with
// them and the image stopped building.
test('catalogOf reads the key the runtime actually serves', () => {
  const served = { iamTenantConfigJson: '{"hanzo.id":{"clientId":"hanzo-console"}}', v: 1 }
  assert.equal(catalogOf(served), '{"hanzo.id":{"clientId":"hanzo-console"}}')
  assert.equal(parseCatalog(catalogOf(served))['hanzo.id']!.clientId, 'hanzo-console')

  // Anything else is not the catalog: no guessing, no second accepted key.
  assert.equal(catalogOf({ iamOrgConfigJson: '{"hanzo.id":{}}' }), undefined)
  assert.equal(catalogOf({}), undefined)
  assert.equal(catalogOf(null), undefined)
  assert.equal(catalogOf(undefined), undefined)
  assert.equal(catalogOf({ iamTenantConfigJson: 42 }), undefined)
})

// The regression that broke the build: App.tsx imports catalogOf from the
// package barrel, so exporting it from org.ts alone is not enough.
test('catalogOf is reachable from the package barrel', async () => {
  const barrel = await import('./index.ts')
  assert.equal(typeof barrel.catalogOf, 'function')
  assert.equal(barrel.catalogOf({ iamTenantConfigJson: '{}' }), '{}')
})

// The fallback and the catalog must name the SAME application per host.
//
// resolveOrg spreads the catalog OVER the built-in table, so a host where the
// two disagree authenticates as one app or the other depending on whether
// /config.json won a race. hanzo.id said `hanzo-id` in the table and
// `hanzo-console` in the catalog, and those two differ in enableSignUp — false
// vs true. On a load where the fetch did not arrive, the signup form rendered
// and the POST came back "the application does not allow to sign up new
// account". Intermittent, device-dependent, and reported from a phone.
//
// This asserts the property that makes the race harmless: for a host present in
// BOTH, resolving with and without the catalog yields the same clientId. It is
// checked against the catalog fixture above, which mirrors the ConfigMap in
// universe/infra/k8s/id/configmap.yaml — so a change to one side that is not
// mirrored in the other fails here rather than in a customer's browser.
test('the built-in fallback names the SAME app as the catalog, per host', () => {
  const CANONICAL: Record<string, string> = {
    'hanzo.id': 'hanzo-console',
    'lux.id': 'lux-cloud',
    'pars.id': 'pars-console',
  }
  for (const [host, clientId] of Object.entries(CANONICAL)) {
    // No catalog — the failed-/config.json path a real visitor can hit.
    assert.equal(resolveOrg(host).clientId, clientId, `${host} fallback`)
    // With the catalog — the ordinary path.
    assert.equal(
      resolveOrg(host, { catalog: { [host]: { clientId, appName: clientId } } }).clientId,
      clientId,
      `${host} with catalog`,
    )
  }
})

// The catalog reader copies a WHITELIST of keys (fromCatalog), so a field added
// to OrgConfig without being added there type-checks everywhere, reads correctly
// at every call site, and is silently undefined in the browser. That is the
// iamTenantConfigJson miss exactly: a live read pointing at a key nothing
// emitted, with nothing logging a thing.
//
// It happened again with these two — the footer rendered the copyright and no
// links, on every brand, with the catalog carrying both. So the fields are
// asserted THROUGH the reader rather than trusted from the type.
test('the catalog carries the footer legal links through to the org', () => {
  const org = resolveOrg('zoolabs.id', {
    catalog: {
      'zoolabs.id': {
        orgId: 'zoo',
        termsUrl: 'https://zoo.ngo/terms',
        privacyUrl: 'https://zoo.ngo/privacy',
      },
    },
  })
  assert.equal(org.termsUrl, 'https://zoo.ngo/terms')
  assert.equal(org.privacyUrl, 'https://zoo.ngo/privacy')
})

// Absent is the DEFAULT and must stay expressible: neither the brand contract
// nor this config ships a legal document, and the footer renders each link only
// when it is set. A resolver that invented one — `${publicOrigin}/terms` — would
// put a 404 under the one link a consumer surface is most often required to get
// right, on every brand at once.
test('a brand that declares no legal pages resolves none', () => {
  const org = resolveOrg('zoolabs.id', { catalog: { 'zoolabs.id': { orgId: 'zoo' } } })
  assert.equal(org.termsUrl, undefined)
  assert.equal(org.privacyUrl, undefined)
})
