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
import { resolveOrg, parseCatalog, catalogJsonFrom } from './org.ts'

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

test('oauthCallbackOrigin comes from the catalog and is NEVER defaulted to this host', () => {
  // The social OAuth clients are registered against ONE origin, the IAM
  // backend's, and no host resolves to it by accident. Defaulting to
  // publicOrigin produced a redirect_uri Google rejects outright — so the value
  // is either declared or absent, and absent means "social is not configured
  // here", which the hop and the buttons both honour.
  const withOrigin = resolveOrg('hanzo.id', {
    catalog: { 'hanzo.id': { orgId: 'hanzo', oauthCallbackOrigin: 'https://iam.hanzo.ai/' } },
  })
  assert.equal(withOrigin.oauthCallbackOrigin, 'https://iam.hanzo.ai') // trailing slash trimmed

  for (const host of ['hanzo.id', 'lux.id', 'pars.id', 'osage.id', 'zoolabs.id', 'anything.example']) {
    const t = resolveOrg(host) // no catalog
    assert.equal(t.oauthCallbackOrigin, undefined, `${host} invented an OAuth callback origin`)
    assert.notEqual(
      t.oauthCallbackOrigin,
      t.publicOrigin,
      `${host} would send the provider its own origin — a guaranteed redirect_uri_mismatch`,
    )
  }
})

test('catalogJsonFrom reads the key the RUNTIME serves, not the one this repo would name', () => {
  // The live document, verbatim: `id-tenant-catalog` ships
  // SPA_IAM_TENANT_CONFIG_JSON, hanzoai/spa camelCases it, so /config.json is
  // `{"iamTenantConfigJson":"<catalog json>"}`. An internal tenant→org rename
  // pointed the reader at `iamOrgConfigJson`; the fetch still returned 200, the
  // key read undefined, and EVERY host silently fell back to the built-ins —
  // which is how hanzo.id came to call itself `hanzo-id` and hand Google
  // `redirect_uri=https://hanzo.id/callback`.
  const served = { iamTenantConfigJson: '{"hanzo.id":{"orgId":"hanzo","oauthCallbackOrigin":"https://iam.hanzo.ai"}}' }
  const raw = catalogJsonFrom(served)
  assert.equal(raw, served.iamTenantConfigJson)
  const org = resolveOrg('hanzo.id', { catalog: parseCatalog(raw) })
  assert.equal(org.oauthCallbackOrigin, 'https://iam.hanzo.ai')

  // The renamed key is NOT accepted: one wire name, and it is the runtime's.
  assert.equal(catalogJsonFrom({ iamOrgConfigJson: served.iamTenantConfigJson }), undefined)
  // Junk in, undefined out — the caller falls through to __ID_CATALOG__/empty.
  assert.equal(catalogJsonFrom(undefined), undefined)
  assert.equal(catalogJsonFrom(null), undefined)
  assert.equal(catalogJsonFrom('a string'), undefined)
  assert.equal(catalogJsonFrom({}), undefined)
  assert.equal(catalogJsonFrom({ iamTenantConfigJson: '' }), undefined)
  assert.equal(catalogJsonFrom({ iamTenantConfigJson: 42 }), undefined)
})
