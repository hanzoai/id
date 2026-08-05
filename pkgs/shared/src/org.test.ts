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
import { resolveOrg, parseCatalog, catalogOf } from './org.ts'

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
 * THE SOCIAL-LOGIN REGRESSION. Google and GitHub each accept a fixed list of
 * redirect URIs and we hold ONE shared OAuth client per provider, so every
 * brand must send the same `redirect_uri` or the provider answers
 * `redirect_uri_mismatch`.
 *
 * `oauthCallbackOrigin` used to default to `publicOrigin` — the brand's own
 * host — and no catalog entry overrode it, so each property sent a different
 * URI and social login could work on at most one of them. The failure surfaced
 * at Google, not here, which is why it read as a credentials problem for days.
 *
 * The default is the ORG'S HOSTED ID HOST — hanzo.id for hanzo, lux.id for lux.
 *
 * This test used to assert the default was `iamIssuer`, which was the FIRST
 * attempt at the fix and was abandoned in the same change that shipped the real
 * one: `hostSkeleton` derives the issuer from the REQUEST HOST, so on an app
 * host the issuer IS the brand host and the bug is unchanged. `org.ts` says so
 * in place. The assertion was left behind and had been failing on `main` ever
 * since, against code that is correct.
 *
 * It was also asking the question on hosts that carry no org: `resolveOrg` was
 * called with NO catalog, so hanzo.app and hanzo.chat fell to the deliberate
 * unknown-host skeleton (empty orgId, fail closed, never another brand's
 * config). No design can make two ORG-LESS hosts agree on one org's callback —
 * the old assertion could not have passed under either default.
 *
 * So ask it the way production does: the catalog (`/config.json`) is what
 * supplies the orgId, and the invariant that matters is one registered URI PER
 * ORG.
 */
test('the provider callback is the org hosted-ID host, one per org', () => {
  const catalog = parseCatalog(
    JSON.stringify({
      'hanzo.app': { orgId: 'hanzo', clientId: 'hanzo-app' },
      'hanzo.chat': { orgId: 'hanzo', clientId: 'hanzo-chat' },
      'console.hanzo.ai': { orgId: 'hanzo', clientId: 'hanzo-cloud' },
      'id.lux.network': { orgId: 'lux', clientId: 'lux-id' },
    }),
  )

  const app = resolveOrg('hanzo.app', { catalog })
  const chat = resolveOrg('hanzo.chat', { catalog })
  const consoleHost = resolveOrg('console.hanzo.ai', { catalog })
  const portal = resolveOrg('hanzo.id', { catalog }) // built-in; needs no row

  // Whatever the property, ONE registered redirect_uri serves them all.
  for (const t of [app, chat, consoleHost, portal]) {
    assert.equal(t.oauthCallbackOrigin, 'https://hanzo.id')
  }

  // And it is NOT the brand host — the precise shape of the bug.
  assert.notEqual(app.oauthCallbackOrigin, app.publicOrigin)
  assert.notEqual(chat.oauthCallbackOrigin, chat.publicOrigin)
  assert.notEqual(consoleHost.oauthCallbackOrigin, consoleHost.publicOrigin)

  // Per-ORG, not global, and NOT the issuer: lux gets lux.id. This is the
  // assertion that pins the abandoned first attempt out of the codebase —
  // under `iamIssuer` this host would send its own origin and break again.
  const lux = resolveOrg('id.lux.network', { catalog })
  assert.equal(lux.oauthCallbackOrigin, 'https://lux.id')
  assert.notEqual(lux.oauthCallbackOrigin, lux.iamIssuer)
})

test('an explicit catalog oauthCallbackOrigin still wins over the issuer', () => {
  const catalog = parseCatalog(
    JSON.stringify({ 'per-host.example': { oauthCallbackOrigin: 'https://its-own-client.example' } }),
  )
  const org = resolveOrg('per-host.example', { catalog })
  assert.equal(org.oauthCallbackOrigin, 'https://its-own-client.example')
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
