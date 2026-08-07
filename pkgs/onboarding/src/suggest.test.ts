import { test } from 'vitest'
import assert from 'node:assert/strict'
import { suggestOrgName, suggestProjectName } from './domain/suggest.ts'

// The suggestion's whole job is to make Continue a legal move on a step that
// would otherwise start with an empty required field, so the ONLY hard property
// is that it always produces something a slug can be made from.
test('suggestOrgName is always a non-empty two-word slug', () => {
  for (let i = 0; i < 200; i++) {
    const n = suggestOrgName()
    assert.match(n, /^[a-z]+-[a-z]+$/, `not a clean slug: ${n}`)
  }
})

// It feeds an org slug that ends up in URLs and derived key paths, so it must
// need no escaping and survive a round trip through the flow's own slugify.
test('suggestOrgName needs no encoding', () => {
  for (let i = 0; i < 200; i++) {
    const n = suggestOrgName()
    assert.equal(encodeURIComponent(n), n, `would be re-encoded: ${n}`)
  }
})

// Not collision-proof by design — the server owns slug uniqueness — but wide
// enough that two people onboarding side by side don't get the same offer.
// Sampling the space also catches a generator wired to a constant.
test('suggestOrgName spans a wide space', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 400; i++) seen.add(suggestOrgName())
  assert.ok(seen.size > 100, `too few distinct names: ${seen.size}`)
})

test('suggestProjectName derives from the org', () => {
  assert.equal(suggestProjectName('acme-inc'), 'acme-inc-site')
  assert.equal(suggestProjectName('brave-otter'), 'brave-otter-site')
})

// The project step is reachable before the org one via the step bar, and an org
// may be skipped entirely, so an absent org must still yield a usable default.
test('suggestProjectName falls back to a bare site with no org', () => {
  assert.equal(suggestProjectName(undefined), 'site')
  assert.equal(suggestProjectName(''), 'site')
  assert.equal(suggestProjectName('   '), 'site')
})

// Passing back through the step must not grow `acme-site-site-site`.
test('suggestProjectName is idempotent on an org already ending in -site', () => {
  assert.equal(suggestProjectName('acme-site'), 'acme-site')
  assert.equal(suggestProjectName(suggestProjectName('acme')), 'acme-site')
})
