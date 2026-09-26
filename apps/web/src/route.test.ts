import { test } from 'vitest'
import assert from 'node:assert/strict'
import { clientIdFrom, hintFrom, signinHref, signupHref } from './route'

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

// ── Links between sign-in and registration ───────────────────────────────────
// A person who reaches sign-in without an account goes to registration, and back,
// without the app's request falling out on the way. Every parameter of the
// authorize request is what lets the new account return to the app that sent it,
// so each one is checked by name and the whole set is compared, in order.

/** An authorize request as IAM forwards it, every parameter an app may send. */
const REQUEST: [string, string][] = [
  ['client_id', 'hanzo-app'],
  ['code_challenge', 'AgX39Cb83kllF6GA7XywQjfcBY8fJhLFTbT_dIbqR2c'],
  ['code_challenge_method', 'S256'],
  ['login_hint', 'alice@example.com'],
  ['max_age', '3600'],
  ['nonce', 'n-0S6_WzA2Mj'],
  ['prompt', 'login'],
  ['redirect_uri', 'https://hanzo.ai/auth/callback?next=/pricing&plan=pro'],
  ['response_mode', 'query'],
  ['response_type', 'code'],
  ['scope', 'openid profile email offline_access'],
  ['state', 'QxkkRKHh+vzO/vqJm0=AqrdG2l&hcWmnYk'],
  ['ui_locales', 'en'],
  ['utm_source', 'pricing'],
]
const SEARCH = `?${new URLSearchParams(REQUEST)}`

/** The path and the parameters, in order, of a same-origin href. */
function parts(href: string): { path: string; params: [string, string][] } {
  const u = new URL(href, 'https://hanzo.id')
  return { path: u.pathname, params: [...u.searchParams] }
}

test('Create account keeps every parameter of the authorize request', () => {
  const to = parts(signupHref('/login/oauth/authorize', SEARCH))
  assert.equal(to.path, '/signup')
  for (const k of ['client_id', 'redirect_uri', 'response_type', 'scope', 'state', 'nonce', 'code_challenge', 'code_challenge_method']) {
    const want = REQUEST.find(([n]) => n === k)![1]
    assert.equal(new Map(to.params).get(k), want, `${k} must reach /signup unchanged`)
  }
  assert.deepEqual(to.params, REQUEST, 'nothing dropped, nothing added, nothing reordered')
})

test('Create account keeps the plain-link shape: /login/<app> opens /signup/<app>', () => {
  assert.equal(signupHref('/login/hanzo-chat', ''), '/signup/hanzo-chat')
  assert.equal(signupHref('/login/hanzo-chat/', '?utm_source=nav'), '/signup/hanzo-chat?utm_source=nav')
  const to = parts(signupHref('/login/hanzo-chat', SEARCH))
  assert.equal(to.path, '/signup/hanzo-chat')
  assert.deepEqual(to.params, REQUEST)
})

test('Create account from a bare sign-in is a bare registration', () => {
  assert.equal(signupHref('/login', ''), '/signup')
  // Not a client segment, so it is not carried: the query names the app here.
  assert.equal(signupHref('/login/oauth/authorize', ''), '/signup')
  assert.equal(signupHref('/login/nodash', ''), '/signup')
})

test('Sign in keeps every parameter of the authorize request', () => {
  const to = parts(signinHref('/signup', SEARCH))
  assert.equal(to.path, '/login')
  assert.deepEqual(to.params, REQUEST, 'nothing dropped, nothing added, nothing reordered')
})

test('Sign in keeps the plain-link shape: /signup/<app> opens /login/<app>', () => {
  assert.equal(signinHref('/signup/hanzo-chat', ''), '/login/hanzo-chat')
  const to = parts(signinHref('/signup/hanzo-chat', SEARCH))
  assert.equal(to.path, '/login/hanzo-chat')
  assert.deepEqual(to.params, REQUEST)
})

test('Sign in drops only the registration hint, which would send it straight back', () => {
  const hints: [string, string][] = [['signup', 'true'], ['screen_hint', 'signup']]
  for (const hint of hints) {
    const to = parts(signinHref('/signup', `?${new URLSearchParams([...REQUEST, hint])}`))
    assert.deepEqual(to.params, REQUEST, `${hint.join('=')} is dropped and nothing else is`)
  }
  // Any other screen_hint is the app's to send and travels.
  const other = parts(signinHref('/signup', '?client_id=hanzo-app&screen_hint=login'))
  assert.deepEqual(other.params, [['client_id', 'hanzo-app'], ['screen_hint', 'login']])
  assert.equal(signinHref('/signup', '?signup=true'), '/login')
})

test('the two links are inverses: sign-in to registration and back is the same request', () => {
  for (const path of ['/login/oauth/authorize', '/login', '/login/hanzo-chat']) {
    const there = parts(signupHref(path, SEARCH))
    const back = parts(signinHref(there.path, `?${new URLSearchParams(there.params)}`))
    assert.deepEqual(back.params, REQUEST, path)
  }
  assert.equal(parts(signinHref('/signup/hanzo-chat', SEARCH)).path, '/login/hanzo-chat')
})

test('login_hint starts the field with an address, never with a subject', () => {
  assert.equal(hintFrom('?login_hint=ada%40example.com&client_id=hanzo-app'), 'ada@example.com')
  assert.equal(hintFrom('?login_hint=3f2504e0-4f89-11d3-9a0c-0305e82c3301'), undefined)
  assert.equal(hintFrom('?login_hint=hanzo%2Fada'), undefined)
  assert.equal(hintFrom('?client_id=hanzo-app'), undefined)
})
