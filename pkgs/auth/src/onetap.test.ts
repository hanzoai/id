/**
 * Google account detection — the fail-silent contract.
 *
 * The value of this module is almost entirely in what it does NOT do when
 * things go wrong, because every failure mode is invisible: the user never
 * asked for a card, so a missing card is not an error they can read. If it ever
 * throws it takes the sign-in page down with it, and the ordinary buttons — the
 * ones that actually work — go with it. These tests run in the suite's `node`
 * environment, which has no `window` and no `document`, so the no-DOM path is
 * exercised for real rather than simulated.
 */
import { test, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import { startOneTap } from './onetap.ts'

const realWindow = (globalThis as Record<string, unknown>).window
const realDocument = (globalThis as Record<string, unknown>).document

afterEach(() => {
  if (realWindow === undefined) delete (globalThis as Record<string, unknown>).window
  else (globalThis as Record<string, unknown>).window = realWindow
  if (realDocument === undefined) delete (globalThis as Record<string, unknown>).document
  else (globalThis as Record<string, unknown>).document = realDocument
})

test('server-side render: no window, no throw, no card', () => {
  // The portal is a SPA today, but this module must never be the reason an
  // import graph cannot be evaluated outside a browser.
  assert.equal(typeof globalThis.window, 'undefined')
  let called = false
  const cancel = startOneTap({ clientId: 'c.apps.googleusercontent.com', onSelect: () => { called = true } })
  assert.equal(typeof cancel, 'function')
  cancel() // cancelling something that never started is safe
  assert.equal(called, false)
})

test('an unconfigured Google provider is a no-op, not a request', () => {
  // IAM reports `clientId: ''` for a provider it holds no real credential for.
  // Initialising GIS with an empty client id would fetch the library and then
  // fail inside Google's code; refusing early keeps it off the wire entirely.
  let called = false
  const cancel = startOneTap({ clientId: '', onSelect: () => { called = true } })
  cancel()
  assert.equal(called, false)
})

test('a blocked or unreachable GIS library leaves the page untouched', () => {
  // The realistic failure: the script tag is appended and never loads — CSP,
  // an offline user, a content blocker. The module must swallow it. We stand up
  // the minimum DOM the loader touches and fire `error` at it.
  const listeners: Record<string, Array<() => void>> = {}
  const script: Record<string, unknown> = {
    addEventListener: (ev: string, fn: () => void) => {
      ;(listeners[ev] ??= []).push(fn)
    },
  }
  ;(globalThis as Record<string, unknown>).window = { google: undefined }
  ;(globalThis as Record<string, unknown>).document = {
    querySelector: () => null,
    createElement: () => script,
    head: { appendChild: () => {} },
    documentElement: {},
  }

  let called = false
  const cancel = startOneTap({ clientId: 'c.apps.googleusercontent.com', onSelect: () => { called = true } })
  // The library failed to load: resolve the load promise down the error path.
  assert.ok(listeners['error']?.length, 'the loader must handle a script error')
  for (const fn of listeners['error']!) fn()
  cancel()
  assert.equal(called, false, 'a failed load must never signal a selection')
})
