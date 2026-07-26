/**
 * Tenant-resolver tests — run with the Node built-in runner + native TS strip:
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
import { resolveTenant, parseCatalog } from './tenant.ts'

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
  const t = resolveTenant('hanzo.id')
  assert.equal(t.orgId, 'hanzo')
  assert.equal(t.brandPackage, '@hanzo/brand')
  assert.equal(t.iamUrl, 'https://hanzo.id')
})

test('a catalog entry overrides clientId/appName but keeps a consistent brand', () => {
  const t = resolveTenant('lux.id', { catalog: CATALOG })
  assert.equal(t.orgId, 'lux')
  assert.equal(t.clientId, 'lux-cloud')
  assert.equal(t.brandPackage, '@luxfi/brand')
  assert.equal(t.iamUrl, 'https://lux.id')
  assert.equal(t.publicOrigin, 'https://lux.id')
})

test('a catalog-ONLY host does NOT leak the Hanzo brand (osage.id regression)', () => {
  const t = resolveTenant('osage.id', { catalog: CATALOG })
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
  const t = resolveTenant('id.bootno.de', { catalog: CATALOG })
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

test('an unknown host still falls back to hanzo (the intended default)', () => {
  const t = resolveTenant('totally-unregistered.example', { catalog: CATALOG })
  assert.equal(t.orgId, 'hanzo')
})

test('pars built-in uses the working pars-console portal app (not the missing pars-id)', () => {
  const t = resolveTenant('pars.id')
  assert.equal(t.clientId, 'pars-console')
  assert.equal(t.brandPackage, '@parsdao/brand')
})

test('osage built-in resolves to Osage even with NO catalog (fallback safety)', () => {
  const t = resolveTenant('osage.id')
  assert.equal(t.orgId, 'osage')
  assert.equal(t.brandPackage, '@osage/brand')
  assert.notEqual(t.brandPackage, '@hanzo/brand')
  assert.equal(t.iamUrl, 'https://osage.id')
})

test('an unknown host falls back to the default org but keeps its own origin', () => {
  const t = resolveTenant('preview.example.com')
  assert.equal(t.orgId, 'hanzo')
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
