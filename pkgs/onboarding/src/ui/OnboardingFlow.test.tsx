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

const pro: PlanInfo = { slug: 'pro', name: 'Pro', priceCents: 1900 }

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

test('choosing a plan records it with completion and finishes the flow', async () => {
  const { svc, saves } = service([[pro]])
  const done: OnboardingState[] = []
  mount(svc, done)
  fireEvent.click(await screen.findByText('Pro'))
  await waitFor(() => assert.equal(done.length, 1))
  assert.equal(done[0]!.planChoice, 'pro')
  const save = saves[0] as { plan: string; completedAt: string }
  assert.equal(save.plan, 'pro')
  assert.ok(save.completedAt)
})
