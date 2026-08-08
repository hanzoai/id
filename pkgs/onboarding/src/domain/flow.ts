/**
 * The onboarding step machine — React-free on purpose.
 *
 * These are the rules that decide where a person lands, where they may go, and
 * what counts as having answered a step. They used to live inside the flow
 * component, where nothing could reach them: the test runner collects `.ts`
 * only, so the reducer, the arrow keys and the step dots were all untestable,
 * and both holes below shipped. They are plain values and pure functions here.
 *
 * TWO RULES, and every behaviour follows from them:
 *
 *   1. Only a step's own submit answers it. Navigation moves the view; it never
 *      satisfies a step. ArrowRight used to dispatch the same "advance" a submit
 *      did, so → walked past the consent and plan screens without calling either
 *      write — and from the plan step it reached the end with no `completedAt`,
 *      which is the one key that stops onboarding re-entering. The step dots did
 *      it too. Now the only way past a step is through it.
 *
 *   2. The ACCOUNT says where to resume, not the browser. Nothing is persisted
 *      here. The flow used to start at step 1 every mount, so a refresh, a
 *      closed tab or a second sign-in restarted it — and step 1 then dead-ended,
 *      because IAM gives an account one org and answers a request for a second
 *      with 409, which the screen rendered as "That name is taken. Try a
 *      different one." No name would ever work. An account provisioned by any
 *      other path (cloud onboards through /v1/iam/admin/provision and never
 *      writes this flow's keys) met that on its FIRST visit.
 *
 * The frontier is what makes both hold: the first UNANSWERED step. Everything
 * before it is answered by construction, everything after it is unreachable, and
 * `resume` derives the answered set from the account rather than from storage.
 */
import { STEPS, prevStep, type Answers, type OnboardingState, type StepId } from './types'

/**
 * Where the person is, what they have answered, and what they have said.
 *
 * `answered` holds the steps whose own submit has run — an explicit skip counts,
 * because declining is an answer. It is what the frontier is computed from, so
 * it is the whole reason navigation cannot stand in for a write.
 */
export interface Flow {
  readonly step: StepId
  readonly answered: readonly StepId[]
  readonly data: OnboardingState
}

/** A move through the flow. Only `answer` may come from a step's own submit. */
export type Move =
  | { readonly kind: 'answer'; readonly patch: Partial<OnboardingState> }
  | { readonly kind: 'back' }
  | { readonly kind: 'goTo'; readonly step: StepId }

/**
 * The first unanswered step — where the flow opens, and the furthest a person
 * may navigate. `done` when every step is answered.
 */
export function frontier(answered: readonly StepId[]): StepId {
  const next = STEPS.find((s) => !answered.includes(s.id))
  return next ? next.id : 'done'
}

/**
 * May the person move to `step`? Answered steps stay open, so passing back
 * through a decision to see or change it is always allowed; the frontier is
 * open because it is where the work is. Nothing beyond it is reachable — that is
 * rule 1, stated once.
 */
export function reachable(answered: readonly StepId[], step: StepId): boolean {
  return answered.includes(step) || step === frontier(answered)
}

/** Open the flow on `answered`/`data`, at the frontier those imply. */
export function start(answered: readonly StepId[] = [], data: OnboardingState = {}): Flow {
  return { step: frontier(answered), answered, data }
}

/**
 * Apply a move.
 *
 * `answer` marks the CURRENT step answered, merges what it recorded, and lands
 * on the new frontier — the next thing actually outstanding, which is why a
 * re-entry converges instead of re-walking steps the account already answers.
 *
 * `back` needs no reachability check: every step before the frontier is answered
 * by the frontier's own definition, so a step's predecessor is always open.
 *
 * `goTo` past the frontier is a no-op rather than an error — a stale click on a
 * dot is not worth an error screen, and refusing to move IS the feedback.
 */
export function move(flow: Flow, m: Move): Flow {
  switch (m.kind) {
    case 'answer': {
      const answered = flow.answered.includes(flow.step) ? flow.answered : [...flow.answered, flow.step]
      return { step: frontier(answered), answered, data: { ...flow.data, ...m.patch } }
    }
    case 'back': {
      const prev = prevStep(flow.step)
      return prev ? { ...flow, step: prev } : flow
    }
    // Jumping keeps `data` untouched: a step already answered stays answered
    // when you pass back through it, so the bar is navigation and never an
    // eraser.
    case 'goTo':
      return reachable(flow.answered, m.step) ? { ...flow, step: m.step } : flow
  }
}

/**
 * Where to resume, read off the ACCOUNT.
 *
 * Each answer IAM already holds retires its step, so the person lands on what is
 * genuinely outstanding and is never asked to found a second org. The signal for
 * the org step is `admin`, which is IAM's OWN first-run gate — provision refuses
 * a second org exactly when the caller already admins one — so the client and
 * the server agree by construction instead of by a client guess.
 *
 * `project` and `wallet` are never pre-answered: nothing records them on the
 * account, and both are optional and additive (a second project and a second
 * wallet are both legal), so offering them again costs nothing and claiming they
 * were answered would be a guess.
 */
export function resume(a: Answers): { answered: StepId[]; data: OnboardingState } {
  const answered: StepId[] = []
  const data: Record<string, unknown> = {}
  if (a.admin && a.org) {
    answered.push('org')
    data.orgName = a.org
  }
  if (a.consent !== null) {
    answered.push('consent')
    data.dataSharingConsent = a.consent
  }
  if (a.plan !== null) {
    answered.push('plan')
    data.planChoice = a.plan
  }
  return { answered, data: data as OnboardingState }
}
