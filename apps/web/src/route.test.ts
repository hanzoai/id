import { test } from 'vitest'
import assert from 'node:assert/strict'
import { clientIdFrom } from './route'

test('the OAuth query shape wins — it is the one carrying a redirect_uri', () => {
  assert.equal(clientIdFrom('?client_id=hanzo-chat', '/signup'), 'hanzo-chat')
  // Both present: the query is the real request; the segment is decoration.
  assert.equal(clientIdFrom('?client_id=hanzo-app', '/signup/hanzo-chat'), 'hanzo-app')
})

test('the plain-link path shape is read — this is the bug hanzo.chat hit', () => {
  // Three live components in hanzoai/chat link exactly here. App.tsx routes
  // `/signup/` and `/login/`, so the shape was accepted and then dropped: the
  // page fell back to the host default and created the account under a
  // DIFFERENT application than the button that asked for it.
  assert.equal(clientIdFrom('', '/signup/hanzo-chat'), 'hanzo-chat')
  assert.equal(clientIdFrom('', '/login/hanzo-chat'), 'hanzo-chat')
  assert.equal(clientIdFrom('', '/signup/hanzo-cloud'), 'hanzo-cloud')
})

test('anything that is not one <org>-<app> segment falls back to the host default', () => {
  // These must stay undefined, or the page would authenticate as whatever junk
  // was in the URL — the fallback is the host's declared app, which is correct.
  for (const p of [
    '/signup',              // bare page, the ordinary case
    '/login',
    '/signup/',             // trailing slash, no segment
    '/signup/nodash',       // not <org>-<app>
    '/signup/a/b',          // deeper path
    '/signup/Hanzo-Chat',   // ids are lower-case
    '/signup/../admin',
    '/',
  ]) {
    assert.equal(clientIdFrom('', p), undefined, p)
  }
})
