/**
 * The phone identifier, mounted.
 *
 * The case that matters is not the formatting — that is libphonenumber's and it is
 * right. It is what leaves the field: most of the world writes a trunk prefix that
 * exists only inside the country, and it is DROPPED once the country code leads. A
 * field that concatenates sends `+44 07911 123456`, which normalises to 44079111…
 * against a stored 447911… and finds nobody. That failure is invisible in the
 * NANP, where concatenation is accidentally correct — so a US-only test passes
 * while every other country is broken.
 */
import { afterEach, test } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { PhoneField } from './PhoneField'

afterEach(cleanup)

/** Mount the field and drive it, reporting what it would post. */
async function field() {
  let sent = ''
  render(<PhoneField label="Phone number" onChange={(v) => (sent = v)} />)
  await waitFor(() => assert.ok(document.querySelector('[data-phone-national]')))
  const input = document.querySelector('[data-phone-national]') as HTMLInputElement
  const select = document.querySelector('select') as HTMLSelectElement
  return {
    type(v: string) {
      fireEvent.change(input, { target: { value: v } })
    },
    pick(c: string) {
      fireEvent.change(select, { target: { value: c } })
    },
    get shown() {
      return input.value
    },
    get sent() {
      return sent
    },
    get dial() {
      return document.querySelector('.hanzo-id-dial')?.textContent?.trim()
    },
    get countries() {
      return select.options.length
    },
  }
}

test('the trunk prefix is dropped once the country code leads', async () => {
  const f = await field()
  f.pick('GB')
  f.type('07911123456')

  assert.equal(f.shown, '07911 123456', 'shown as it is written in the country')
  assert.equal(f.sent, '+44 7911 123456', 'sent WITHOUT the trunk 0')
})

// Four more countries, because the bug is per-country and getting one right proves
// nothing about the rest. Note BR: the national form groups 98765-4321 with a
// hyphen and the international form uses a space. What is shown and what is sent
// are different strings — that is the whole point of composing rather than
// concatenating, and it is why these expectations were read off the library
// instead of guessed (this one was guessed first, and was wrong).
test('every trunk-prefix country composes correctly', async () => {
  for (const [country, typed, sent] of [
    ['DE', '015112345678', '+49 1511 2345678'],
    ['FR', '0612345678', '+33 6 12 34 56 78'],
    ['JP', '09012345678', '+81 90 1234 5678'],
    ['BR', '11987654321', '+55 11 98765 4321'],
  ] as const) {
    const f = await field()
    f.pick(country)
    f.type(typed)
    assert.equal(f.sent, sent, `${country} composed wrong`)
    cleanup()
  }
})

test('a NANP number keeps its own shape', async () => {
  const f = await field()
  f.pick('US')
  f.type('9137779708')

  assert.equal(f.shown, '(913) 777-9708')
  assert.equal(f.sent, '+1 913 777 9708')
  assert.equal(f.dial, '+1')
})

// Choosing the country after typing is what someone does when the default was
// wrong, so the digits survive it.
test('switching country keeps the digits and moves the dial code', async () => {
  const f = await field()
  f.pick('US')
  f.type('9137779708')
  f.pick('GB')

  assert.equal(f.dial, '+44')
  assert.match(f.shown, /9137779708/, 'the digits are still there')
})

test('an empty field sends nothing at all', async () => {
  const f = await field()
  f.type('123')
  f.type('')

  assert.equal(f.sent, '', 'an empty field is not a dial code')
})

// Every country, from the library — a hand-kept list is a list that goes stale.
test('the whole world is offered', async () => {
  const f = await field()
  assert.ok(f.countries > 200, `expected the full country list, got ${f.countries}`)
})
