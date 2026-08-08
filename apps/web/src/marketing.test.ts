import { test } from 'vitest'
import assert from 'node:assert/strict'
import { appsFor, billingFor } from './marketing'

// A tile that lands on an error page teaches people the tiles are broken — the
// reason the launcher above BILLING already dropped Analytics, Platform and
// Storage. The Billing tile then did the same thing to three of the four brands:
// billing.hanzo.ai answers 200, and billing.lux.network, billing.zoo.network and
// billing.pars.network do not resolve at all.
test('only a brand with a live billing host gets a billing tile', () => {
  assert.equal(billingFor('hanzo'), 'https://billing.hanzo.ai')
  for (const brand of ['lux', 'zoo', 'pars']) {
    assert.equal(billingFor(brand), undefined, `${brand} has no billing host — no tile`)
  }
})

// And it must not inherit Hanzo's. The billing app white-labels by hostname, so
// billing.hanzo.ai shown to a Lux customer is the Hanzo brand on a Lux surface.
test('a brand with no billing host never inherits another brand\'s', () => {
  for (const brand of ['lux', 'zoo', 'pars', 'unknown-brand']) {
    assert.notEqual(billingFor(brand), 'https://billing.hanzo.ai')
  }
})

// An unknown brand is not Hanzo either — guessing a tenant is how one org's
// surface ends up advertising another's host.
test('an unknown brand gets no billing host', () => {
  assert.equal(billingFor('nope'), undefined)
})

// The launcher still answers for every brand; only billing is host-gated.
test('the app launcher is unaffected', () => {
  for (const brand of ['hanzo', 'lux', 'zoo', 'pars']) {
    assert.ok(appsFor(brand).length > 0)
  }
})
