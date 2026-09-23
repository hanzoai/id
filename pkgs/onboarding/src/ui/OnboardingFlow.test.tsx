/**
 * The plan step as a person meets it: no Skip, no way past it by keyboard, and a
 * catalog that fails offers a Retry rather than a choice.
 */
import { afterEach, test } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { OnboardingState, PlanInfo } from '../domain/types'
import type { OnboardingService } from '../service/onboarding'
import { OnboardingFlow } from './OnboardingFlow'

afterEach(cleanup)

const pro: PlanInfo = { slug: 'pro', name: 'Pro', priceCents: 1900, perSeat: false, minSeats: 1 }
const team: PlanInfo = { slug: 'team', name: 'Team', priceCents: 2400, perSeat: true, minSeats: 2 }

/** A service whose catalog answers from `catalogs` in turn, recording every save. */
function service(catalogs: PlanInfo[][]) {
  const saves: unknown[] = []
  let reads = 0
  const svc: OnboardingService = {
    createOrg: async () => ({ ok: false, error: 'unused' }),
    createProject: async () => ({ ok: false, error: 'unused' }),
    readOnboarding: async () => ({ completedAt: null, consent: null, plan: null, org: null, admin: false }),
    saveOnboarding: async (patch) => {
      saves.push(patch)
      return { ok: true, value: true }
    },
    listPlans: async () => catalogs[Math.min(reads++, catalogs.length - 1)]!,
  }
  return { svc, saves, reads: () => reads }
}

function mount(svc: OnboardingService, done: OnboardingState[] = []) {
  return render(
    <OnboardingFlow
      service={svc}
      brandName="Hanzo"
      initial={{ answered: ['org', 'project', 'wallet', 'consent'], data: { orgName: 'acme' } }}
      onComplete={(s) => done.push(s)}
      payUrl="https://pay.example"
    />,
  )
}

test('the plan step offers no Skip, and → does not leave it', async () => {
  const { svc, saves } = service([[pro]])
  const done: OnboardingState[] = []
  mount(svc, done)
  await screen.findByText('Pro')
  assert.equal(screen.queryByText('Skip'), null)
  assert.ok(screen.queryByText('Pay as you go'))

  fireEvent.keyDown(window, { key: 'ArrowRight' })
  assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Choose how you pay')
  assert.deepEqual(done, [])
  assert.deepEqual(saves, [])
})

test('a failed catalog offers Retry and no choice, then the plans once it answers', async () => {
  const { svc, saves, reads } = service([[], [pro]])
  mount(svc)
  await screen.findByText(/Plans could not be loaded/)
  assert.equal(screen.queryByText('Skip'), null)
  assert.equal(screen.queryByText('Pay as you go'), null)
  assert.ok(screen.getByRole('button', { name: 'Retry' }))

  fireEvent.click(screen.getByText('Retry'))
  await screen.findByText('Pro')
  assert.equal(reads(), 2)
  assert.deepEqual(saves, [])
})

test('choosing a plan records the choice, not completion, and hands off to checkout', async () => {
  const { svc, saves } = service([[pro]])
  const done: OnboardingState[] = []
  mount(svc, done)
  fireEvent.click(await screen.findByText('Pro'))
  await waitFor(() => assert.equal(done.length, 1))
  assert.equal(done[0]!.planChoice, 'pro')
  assert.equal(done[0]!.orgName, 'acme')
  assert.deepEqual(saves, [{ plan: 'pro' }])
})

test('prices are monthly, and a per-seat plan states its seat floor and first charge', async () => {
  const { svc } = service([[pro, team]])
  mount(svc)
  await screen.findByText('Team')
  assert.ok(screen.getByText('$19/mo'))
  assert.ok(screen.getByText('$24 per seat/mo · minimum 2 seats · first charge $48'))
  assert.equal(screen.queryByText(/annual|\/yr/), null)
})
