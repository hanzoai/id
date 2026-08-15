import { test } from 'vitest'
import assert from 'node:assert/strict'
import { sectionOf } from './section'

// The address bar IS the section, so a link to a section has to survive a paste
// and a reload. These are the shapes a browser actually produces.

test('the bare account path is the profile', () => {
  assert.equal(sectionOf('/account'), '')
  assert.equal(sectionOf('/account/'), '')
})

test('a named section is read from the first segment', () => {
  assert.equal(sectionOf('/account/security'), 'security')
  assert.equal(sectionOf('/account/organizations'), 'organizations')
  assert.equal(sectionOf('/account/apps'), 'apps')
})

test('an unknown section falls back rather than rendering nothing', () => {
  // Every section is conditional on an exact match, so an unrecognised segment
  // that returned itself would paint a page with a nav and no content.
  assert.equal(sectionOf('/account/nope'), '')
  assert.equal(sectionOf('/account/security/extra'), 'security')
})
