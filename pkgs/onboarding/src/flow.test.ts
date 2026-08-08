/**
 * Step-machine tests — the rules that decide where a person lands and what they
 * may pass without answering.
 *
 * None of this could be tested before: the machine lived inside OnboardingFlow
 * .tsx, the runner collects `.ts` only, and there is no DOM harness in this repo
 * — so the reducer, the arrow keys and the step dots were all unreachable, and
 * both holes below shipped to production. The machine is React-free now, which is
 * what makes these facts assertable without dragging in a DOM.
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { frontier, move, reachable, resume, start } from './domain/flow.ts'
import type { Answers } from './domain/types.ts'

/** A brand-new account: nothing answered anywhere. */
const fresh: Answers = { completedAt: null, consent: null, plan: null, org: 'hanzo', admin: false }

test('a brand-new account opens at the first step', () => {
  assert.equal(frontier([]), 'org')
  assert.equal(start().step, 'org')
  assert.equal(start([], {}).step, 'org')
})

test('the frontier is the first UNANSWERED step, and `done` once all are answered', () => {
  assert.equal(frontier(['org']), 'project')
  assert.equal(frontier(['org', 'project']), 'wallet')
  // Order does not matter — it is a set of answers, not a cursor.
  assert.equal(frontier(['consent', 'org']), 'project')
  assert.equal(frontier(['org', 'project', 'wallet', 'consent', 'plan']), 'done')
})

// DEFECT: → dispatched the same move a submit did, so it walked past consent and
// plan without either one writing — and from the plan step it reached the end with
// no `completedAt`, the one key that stops onboarding re-entering. The step dots
// did the same by click. Navigation may now only reach what is already answered
// plus the frontier, so it cannot stand in for a step's own write.
test('navigation cannot pass a step that has not been answered', () => {
  const flow = start([], {})
  assert.equal(flow.step, 'org')

  // The arrow-key move and the dot click are both `goTo`.
  for (const target of ['project', 'wallet', 'consent', 'plan', 'done'] as const) {
    assert.equal(reachable(flow.answered, target), false, `${target} must be out of reach`)
    assert.equal(move(flow, { kind: 'goTo', step: target }).step, 'org', `goTo ${target} must not move`)
  }
})

test('only a step’s own answer advances the frontier', () => {
  let flow = start([], {})
  flow = move(flow, { kind: 'answer', patch: { orgName: 'acme' } })
  assert.equal(flow.step, 'project')
  assert.deepEqual(flow.answered, ['org'])
  assert.equal(flow.data.orgName, 'acme')
  // Now — and only now — the step behind is navigable, and the one ahead is not.
  assert.equal(reachable(flow.answered, 'org'), true)
  assert.equal(reachable(flow.answered, 'wallet'), false)
})

test('an answered step stays reachable, and passing back through it erases nothing', () => {
  let flow = start([], {})
  flow = move(flow, { kind: 'answer', patch: { orgName: 'acme' } })
  flow = move(flow, { kind: 'goTo', step: 'org' })
  assert.equal(flow.step, 'org')
  assert.equal(flow.data.orgName, 'acme')
  assert.deepEqual(flow.answered, ['org'])
})

test('back walks toward the head and stops there', () => {
  let flow = start(['org', 'project'], {})
  assert.equal(flow.step, 'wallet')
  flow = move(flow, { kind: 'back' })
  assert.equal(flow.step, 'project')
  flow = move(flow, { kind: 'back' })
  assert.equal(flow.step, 'org')
  flow = move(flow, { kind: 'back' })
  assert.equal(flow.step, 'org', 'the first step has nothing before it')
})

test('answering the last outstanding step lands on done', () => {
  let flow = start(['org', 'project', 'wallet', 'consent'], {})
  assert.equal(flow.step, 'plan')
  flow = move(flow, { kind: 'answer', patch: { planChoice: 'payg' } })
  assert.equal(flow.step, 'done')
  assert.equal(flow.data.planChoice, 'payg')
})

// DEFECT: the flow restarted at step 1 on every mount, and step 1 then dead-ended
// — IAM gives an account one org and answers a request for a second with 409,
// which the screen rendered as "That name is taken. Try a different one." No name
// would ever work. Resuming from the account is what removes the restart; the
// `admin` flag is IAM's OWN gate, so the client and the server agree by
// construction.
test('an account that already admins an org resumes past the org step', () => {
  const { answered, data } = resume({ ...fresh, org: 'acme', admin: true })
  assert.deepEqual(answered, ['org'])
  assert.equal(data.orgName, 'acme')
  assert.equal(start(answered, data).step, 'project', 'must not re-offer founding an org')
})

// The case that met the dead end on its FIRST visit: an account provisioned
// somewhere else (cloud drives /v1/iam/admin/provision and never writes this
// flow's keys) has an org but no completion, no consent and no plan.
test('an account provisioned elsewhere resumes without being asked to found an org', () => {
  const { answered, data } = resume({
    completedAt: null,
    consent: null,
    plan: null,
    org: 'customer-co',
    admin: true,
  })
  const flow = start(answered, data)
  assert.equal(flow.step, 'project')
  assert.equal(flow.data.orgName, 'customer-co')
  assert.equal(reachable(flow.answered, 'org'), true, 'still visitable, to see the org they have')
})

test('a stored consent answer retires the consent step and carries its value', () => {
  const granted = resume({ ...fresh, consent: true })
  assert.ok(granted.answered.includes('consent'))
  assert.equal(granted.data.dataSharingConsent, true)

  // A refusal is an ANSWER too — it must not re-ask.
  const refused = resume({ ...fresh, consent: false })
  assert.ok(refused.answered.includes('consent'))
  assert.equal(refused.data.dataSharingConsent, false)

  // Never asked: the step stays outstanding.
  assert.equal(resume(fresh).answered.includes('consent'), false)
})

test('an account with an org and an answered consent lands on what is left', () => {
  const { answered, data } = resume({ ...fresh, org: 'acme', admin: true, consent: true, plan: 'pro' })
  assert.deepEqual(answered.slice().sort(), ['consent', 'org', 'plan'])
  const flow = start(answered, data)
  assert.equal(flow.step, 'project', 'the first thing genuinely outstanding')
  // Answering it moves to the next OUTSTANDING step, skipping the answered ones,
  // so a re-entry converges instead of re-walking the whole flow.
  assert.equal(move(flow, { kind: 'answer', patch: {} }).step, 'wallet')
  assert.equal(move(move(flow, { kind: 'answer', patch: {} }), { kind: 'answer', patch: {} }).step, 'done')
})

test('project and wallet are never pre-answered — nothing on the account records them', () => {
  const { answered } = resume({ ...fresh, org: 'acme', admin: true, consent: true, plan: 'pro' })
  assert.equal(answered.includes('project'), false)
  assert.equal(answered.includes('wallet'), false)
})

test('a fresh account resumes to nothing answered', () => {
  assert.deepEqual(resume(fresh), { answered: [], data: {} })
})
