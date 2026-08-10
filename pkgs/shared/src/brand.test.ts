/**
 * Who a white-label portal says it belongs to.
 *
 * The portal already resolves which brand a host is; the company is a second
 * fact about that brand, and getting it wrong on a legal line is a different
 * kind of error from getting a logo wrong.
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { company, idBrandLabel } from './brand'
import { resolveOrg } from './org'

const anyBrand = { name: 'Hanzo' }

test('each brand names its own company, not its trademark', () => {
  assert.equal(company(anyBrand, 'hanzo')?.name, 'Hanzo AI Inc')
  assert.equal(company(anyBrand, 'zoo')?.name, 'Zoo Labs Foundation Inc')
  assert.equal(company(anyBrand, 'lux')?.name, 'Lux Industries Inc')
})

// Zoo is the case that proves the map is needed: "Zoo" + " Inc" is not the
// company, and neither is the brand package's own display name.
test('a company is not derivable from the brand name', () => {
  assert.notEqual(company({ name: 'Zoo' }, 'zoo')?.name, 'Zoo Inc')
  assert.equal(company({ name: 'Zoo Exchange' }, 'zoo')?.name, 'Zoo Labs Foundation Inc')
})

// The org slug wins over the brand package's name for the same reason
// idBrandLabel prefers it: a package may ship a product name.
test('the org decides, and the brand package cannot override it', () => {
  assert.equal(company({ name: 'Lux Exchange' }, 'lux')?.name, 'Lux Industries Inc')
  assert.equal(idBrandLabel({ name: 'Lux Exchange' }, 'lux'), 'Lux ID')
})

// pars.id, id.bootno.de and osage.id are live hosts with no company declared.
// Null is the answer that keeps the footer from inventing one.
test('a brand with no declared company gets none', () => {
  assert.equal(company({ name: 'Pars' }, 'pars'), null)
  assert.equal(company({ name: 'Osage' }, 'osage'), null)
  assert.equal(company({ name: 'Whoever' }), null)
})

// Every URL in the map was fetched. A link is declared only where the page
// exists, so an org may publish one, both or neither — hanzo has both, zoo
// publishes one combined page, and lux.network serves its SPA shell for any
// path including /terms.
test('a legal page is declared only where it exists', () => {
  const hanzo = company(anyBrand, 'hanzo')
  assert.equal(hanzo?.terms, 'https://hanzo.ai/terms')
  assert.equal(hanzo?.privacy, 'https://hanzo.ai/privacy')

  const zoo = company(anyBrand, 'zoo')
  assert.equal(zoo?.terms, 'https://zoo.ngo/terms')
  assert.equal(zoo?.privacy, undefined, 'zoo.ngo/privacy is a 404 — its own Privacy link goes to /terms')

  const lux = company(anyBrand, 'lux')
  assert.equal(lux?.terms, undefined, 'lux.network serves the same document for /terms as for a nonsense path')
  assert.equal(lux?.privacy, undefined)
})

// The map is keyed by brand, the portal is keyed by host, and the two agree only
// because idBrandLabel bridges them. This walks it from the host end — the end a
// person actually arrives from — because a host whose company is missing shows a
// blank footer and nothing else complains.
test('every built-in host reaches the company it belongs to', () => {
  // The built-in hosts, spelled out rather than read off the table: naming them
  // is what makes adding one a decision instead of a silent inheritance.
  const HOSTS = ['hanzo.id', 'lux.id', 'pars.id', 'osage.id', 'www.osage.id']

  const reached = HOSTS.map((host) => {
    const org = resolveOrg(host)
    // fallbackBrand's own derivation, so this reads what a browser that never
    // fetched a brand package would show — the worst case, not the best.
    const scope = (org.brandPackage ?? '@hanzo/brand').replace(/^@/, '').split('/')[0] ?? 'hanzo'
    const named: Record<string, string> = { luxfi: 'Lux', zooai: 'Zoo', parsdao: 'Pars' }
    const name = named[scope] ?? scope.charAt(0).toUpperCase() + scope.slice(1)
    return [host, company({ name }, org.orgId)?.name ?? null] as const
  })

  assert.deepEqual(reached, [
    ['hanzo.id', 'Hanzo AI Inc'],
    ['lux.id', 'Lux Industries Inc'],
    // Nobody has declared a company for Pars or Osage, so their footers carry
    // the mark alone. Asserted rather than left blank so it stays a choice.
    ['pars.id', null],
    ['osage.id', null],
    ['www.osage.id', null],
  ])
})

// Zoo has NO built-in host — zoolabs.id lives only in the runtime catalog, and so
// do id.bootno.de and every www. alias. The company must survive that path too,
// which it does because the catalog carries the orgId and the orgId is what the
// map is keyed on. Rows copied from universe/infra/k8s/id/configmap.yaml.
test('a catalog-only host reaches its company', () => {
  const catalog = {
    'zoolabs.id': { orgId: 'zoo', clientId: 'zoo-console', appName: 'zoo-console' },
    'id.zoo.network': { orgId: 'zoo', clientId: 'zoo-console', appName: 'zoo-console' },
    'id.bootno.de': { orgId: 'bootnode', clientId: 'bootnode-platform', appName: 'bootnode-platform' },
  }
  const at = (host: string) => company({ name: 'Whatever' }, resolveOrg(host, { catalog }).orgId)

  assert.equal(at('zoolabs.id')?.name, 'Zoo Labs Foundation Inc')
  assert.equal(at('id.zoo.network')?.name, 'Zoo Labs Foundation Inc', 'an alias is the same company')
  assert.equal(at('id.bootno.de'), null, 'bootnode has no company declared')
})
