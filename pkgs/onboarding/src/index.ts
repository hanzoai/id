// @hanzo/id-onboarding — post-login onboarding for the Hanzo ID portal.
//
// Five-step flow: choose/create org → optional project → optional wallet
// link → data-sharing consent → plan or pay-as-you-go. White-labeled by the
// host's brand name. Domain (serializable types + step machine) / service
// (IAM-backed writes) / UI (self-contained flow) split. Auth lives in
// @hanzo/id-auth — import login/signup from there.

// ── Domain ──────────────────────────────────────────────────────
export {
  STEPS,
  stepById,
  nextStep,
  prevStep,
  type Answers,
  type StepId,
  type StepDesc,
  type OrgRef,
  type ProjectRef,
  type OnboardingState,
  type PlanInfo,
} from './domain/types'

// The step machine: `resume` turns what the account answers into where the flow
// opens, which is the whole reason the host needs it.
export {
  frontier,
  move,
  reachable,
  resume,
  start,
  type Flow,
  type Move,
} from './domain/flow'

// ── Service ─────────────────────────────────────────────────────
export {
  createOnboardingService,
  type OnboardingService,
  type OnboardingServiceOptions,
  type Result,
} from './service/onboarding'

// ── UI ──────────────────────────────────────────────────────────
export { OnboardingFlow, type OnboardingFlowProps } from './ui/OnboardingFlow'
