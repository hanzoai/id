import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { TenantConfig } from '@hanzo/id-shared'
import { createAuthClient, trainingOf } from './client.ts'
import { SignupForm, TRAINING_CONSENT_TEXT } from './ui/SignupForm.tsx'

// The three values `/v1/iam/signup` accepts for `training`. Any other spelling
// ("true", "yes", "Granted", a trailing space) makes IAM reject the whole
// signup, so the client must never emit one.
const ACCEPTED = ['granted', 'refused', ''] as const

// Same capturing fetch double as client.test.ts: records the parsed JSON body of
// each call and answers a canned IAM "ok". No network.
function capturingFetch() {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString()
    let body: Record<string, unknown> = {}
    if (init?.body && typeof init.body === 'string') body = JSON.parse(init.body)
    calls.push({ url, body })
    return new Response(JSON.stringify({ status: 'ok', data: 'AUTHCODE' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return { calls, fetchImpl }
}

function tenant(): TenantConfig {
  return {
    orgId: 'hanzo',
    iamUrl: 'https://hanzo.id',
    iamIssuer: 'https://hanzo.id',
    clientId: 'hanzo-id',
    appName: 'hanzo-id',
    publicOrigin: 'https://hanzo.id',
    oauthCallbackOrigin: 'https://hanzo.id',
    brandPackage: '@hanzo/brand',
  }
}

// Post a signup exactly as SignupForm does, given the state of its consent box,
// and hand back the body IAM would have received. `undefined` models a caller
// that never asks the question at all.
async function bodyOf(consent?: boolean): Promise<Record<string, unknown>> {
  const { calls, fetchImpl } = capturingFetch()
  const client = createAuthClient({ tenant: tenant(), fetchImpl })
  await client.signup({
    email: 'new@hanzo.ai',
    password: 'correct horse battery staple',
    clientId: 'hanzo-id',
    application: 'hanzo-id',
    organization: 'hanzo',
    ...(consent === undefined ? {} : { training: trainingOf(consent) }),
  })
  assert.equal(calls.length, 1)
  return calls[0]!.body
}

test('a ticked box posts training:"granted"', async () => {
  const body = await bodyOf(true)
  assert.equal(body.training, 'granted')
})

test('an unticked box posts training:"refused" — a declined answer, sent as such', async () => {
  const body = await bodyOf(false)
  assert.equal(body.training, 'refused')
})

// Fail-closed: a surface that never asks must not opt its users in by omission.
// IAM reads an absent key exactly like `refused`, so the client sends nothing
// rather than inventing an answer.
test('a caller that never asks posts no training key, and never "granted"', async () => {
  const body = await bodyOf()
  assert.notEqual(body.training, 'granted', 'silence is never consent')
  if ('training' in body) {
    assert.equal(body.training, '', 'the only value an unasked surface may send is the empty answer')
  }
})

// The wire value is one of exactly three spellings, whatever the answer was.
test('every posted training value is one of the three IAM accepts', async () => {
  for (const consent of [true, false, undefined]) {
    const body = await bodyOf(consent)
    if (!('training' in body)) continue
    assert.ok(
      ACCEPTED.includes(body.training as (typeof ACCEPTED)[number]),
      `posted training ${JSON.stringify(body.training)} is not one of ${JSON.stringify(ACCEPTED)}`,
    )
  }
})

// The screen itself, rendered to static markup (no DOM needed): the question is
// on screen before the account is created, its box starts empty, and declining
// does not cost the user the account.
function signupMarkup(): string {
  const { fetchImpl } = capturingFetch()
  const client = createAuthClient({ tenant: tenant(), fetchImpl })
  return renderToStaticMarkup(createElement(SignupForm, { client }))
}

test('the signup screen asks the training question on screen', () => {
  assert.ok(
    signupMarkup().includes(TRAINING_CONSENT_TEXT),
    'the consent sentence must be rendered, not merely available to the client',
  )
})

test('the consent box starts unticked', () => {
  const markup = signupMarkup()
  const box = markup.match(/<input[^>]*type="checkbox"[^>]*>/)
  assert.ok(box, 'the signup screen renders a checkbox')
  assert.ok(!/checked/.test(box[0]), `the box must render unticked, got ${box[0]}`)
})

test('the submit button is live while the box is unticked', () => {
  const markup = signupMarkup()
  const button = markup.match(/<button[^>]*>/)
  assert.ok(button, 'the signup screen renders a submit button')
  assert.ok(
    !/disabled/.test(button[0]),
    `declining must still create an account, so the answer cannot gate submit, got ${button[0]}`,
  )
})
