// @hanzo/id-onboarding — post-login onboarding for the Hanzo ID portal.
//
// Three-step flow: choose/create org → optional project → optional wallet
// link. White-labeled by the host's brand name. Domain (serializable types +
// step machine) / service (IAM-backed writes) / UI (self-contained flow)
// split. Auth lives in @hanzo/id-auth — import login/signup from there.

// ── Domain ──────────────────────────────────────────────────────
export {
  STEPS,
  stepById,
  nextStep,
  prevStep,
  type StepId,
  type StepDesc,
  type OrgRef,
  type ProjectRef,
  type OnboardingState,
} from './domain/types'

// ── Service ─────────────────────────────────────────────────────
export {
  createOnboardingService,
  type OnboardingService,
  type OnboardingServiceOptions,
  type Result,
} from './service/onboarding'

// ── UI ──────────────────────────────────────────────────────────
export { OnboardingFlow, type OnboardingFlowProps } from './ui/OnboardingFlow'
