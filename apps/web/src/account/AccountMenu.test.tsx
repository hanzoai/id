/**
 * The account chip: every account signed in on this browser, the switch between
 * them, a new one, and the two sign-outs. The page owns what each one does; this
 * pins that the chip offers each, to the right account.
 */
import { afterEach, test } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { BrowserAccount } from '@hanzo/id-auth'
import { AccountMenu } from './AccountMenu'

afterEach(cleanup)

const ALICE: BrowserAccount = { sub: 'a-1', owner: 'hanzo', name: 'alice', displayName: 'Alice Tester', email: 'alice@example.test' }
const BOB: BrowserAccount = { sub: 'b-2', owner: 'hanzo', name: 'bob', displayName: 'Bob Tester', email: 'bob@example.test' }

type Seen = { switched: BrowserAccount[]; added: number; out: BrowserAccount[]; all: number; org: string[] }

function mount(accounts: BrowserAccount[]) {
  const seen: Seen = { switched: [], added: 0, out: [], all: 0, org: [] }
  render(
    <AccountMenu
      accounts={accounts}
      orgs={[{ id: 'hanzo' }, { id: 'acme' }]}
      currentOrg="hanzo"
      onSwitch={(a) => seen.switched.push(a)}
      onOrgSwitch={(o) => seen.org.push(o)}
      onAdd={() => seen.added++}
      onSignOut={(a) => seen.out.push(a)}
      onSignOutAll={() => seen.all++}
    />,
  )
  return seen
}

const chip = () => document.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
const item = (text: string) =>
  [...document.querySelectorAll('[role^="menuitem"]')].find((e) => e.textContent?.includes(text)) as HTMLElement | undefined

test('the chip names the current account and opens a menu of every account here', () => {
  mount([BOB, ALICE])
  assert.match(chip().textContent ?? '', /Bob Tester/)
  assert.equal(chip().getAttribute('aria-expanded'), 'false')

  fireEvent.click(chip())
  assert.equal(chip().getAttribute('aria-expanded'), 'true')
  assert.ok(document.querySelector('[role="menu"]'), 'the menu opens')
  const bob = item('bob@example.test')
  const alice = item('alice@example.test')
  assert.equal(bob?.getAttribute('aria-checked'), 'true', 'the current account is marked')
  assert.equal(alice?.getAttribute('aria-checked'), 'false')
  assert.ok(item('Add another account'))
  assert.ok(item('Sign out of bob@example.test'))
  assert.ok(item('Sign out of all accounts'))
})

test('choosing another account switches to it, and only it', () => {
  const seen = mount([BOB, ALICE])
  fireEvent.click(chip())
  fireEvent.click(item('alice@example.test')!)
  assert.deepEqual(seen.switched, [ALICE])
  assert.equal(document.querySelector('[role="menu"]'), null, 'the menu closes on a choice')
})

test('add, sign out of this account, and sign out of all each do their one thing', () => {
  const seen = mount([BOB, ALICE])
  fireEvent.click(chip())
  fireEvent.click(item('Add another account')!)
  fireEvent.click(chip())
  fireEvent.click(item('Sign out of bob@example.test')!)
  fireEvent.click(chip())
  fireEvent.click(item('Sign out of all accounts')!)
  assert.equal(seen.added, 1)
  assert.deepEqual(seen.out, [BOB], 'signing out of this account names the current one')
  assert.equal(seen.all, 1)
  assert.deepEqual(seen.switched, [])
})

test('one account: a plain Sign out, and no sign-out of all', () => {
  const seen = mount([ALICE])
  fireEvent.click(chip())
  assert.ok(item('Add another account'))
  assert.equal(item('Sign out of all accounts'), undefined)
  fireEvent.click(item('Sign out')!)
  assert.deepEqual(seen.out, [ALICE])
})

test('the current account’s organizations switch from the same menu', () => {
  const seen = mount([BOB, ALICE])
  fireEvent.click(chip())
  fireEvent.click(item('acme')!)
  assert.deepEqual(seen.org, ['acme'])
})

test('Escape closes the menu', () => {
  mount([BOB, ALICE])
  fireEvent.click(chip())
  fireEvent.keyDown(document, { key: 'Escape' })
  assert.equal(document.querySelector('[role="menu"]'), null)
})

test('a picture that does not load gives way to the initial', () => {
  mount([{ ...BOB, avatar: 'https://example.invalid/bob.png' }, ALICE])
  const img = chip().querySelector('img') as HTMLImageElement
  assert.ok(img, 'the picture is tried first')
  fireEvent.error(img)
  assert.equal(chip().querySelector('img'), null)
  assert.match(chip().querySelector('.id-acct-avatar')?.textContent ?? '', /^B$/)
})
