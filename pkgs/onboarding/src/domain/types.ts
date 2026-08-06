/**
 * Onboarding domain types — React-free, serializable.
 *
 * The post-login onboarding is a four-step linear flow:
 *
 *   1. org     — choose an existing org the user already belongs to, or
 *                create a new one. Required (every account needs a home org).
 *   2. project — create a first project inside the chosen org. Optional
 *                (skippable; the org ships with a default project).
 *   3. wallet  — link a Web3 wallet to the account. Optional (skippable).
 *   4. consent — answer the data-sharing question. Required, because an
 *                unanswered question is not permission: skipping it would
 *                record nothing and leave the account in the state that means
 *                "still ask". Either answer satisfies it.
 *
 * The flow is declared as data here so the UI layer can render it without
 * the domain importing React. `OnboardingService` (the service layer) does
 * the actual IAM writes; this module only describes the shape of the flow
 * and its accumulated state.
 */

/** Identifier for each step in the onboarding flow. */
export type StepId = 'org' | 'project' | 'wallet' | 'consent' | 'done'

/**
 * The three states a consent question can be in, mirroring IAM's closed set
 * (`schema.Answer`). The empty string is UNANSWERED and is the zero value on
 * purpose: a record that was never written, a blob that failed to parse, and an
 * absent field all read the same way, and that way is NOT permission.
 */
export type ConsentAnswer = '' | 'granted' | 'refused'

/**
 * The consent record as IAM stores it. `insights` defaults ON; `training`
 * defaults UNANSWERED, which is the state that means the screen still has to ask.
 */
export interface ConsentRecord {
  readonly insights: boolean
  readonly training: ConsentAnswer
}

/** A step's place in the linear flow. */
export interface StepDesc {
  readonly id: StepId
  /** Heading shown at the top of the step. */
  readonly title: string
  /** One-line subhead under the title. */
  readonly byline: string
  /** Whether the user may skip this step (Continue without acting). */
  readonly skippable: boolean
}

/**
 * The canonical step sequence. `done` is a terminal pseudo-step the flow
 * lands on after `wallet`; it renders the success state and hands control
 * back to the host via `onComplete`.
 */
export const STEPS: readonly StepDesc[] = [
  {
    id: 'org',
    title: 'Choose your organization',
    byline: 'Pick an organization you belong to, or create a new one.',
    skippable: false,
  },
  {
    id: 'project',
    title: 'Create your first project',
    byline: 'Projects group your apps, keys, and usage. You can add more later.',
    skippable: true,
  },
  {
    id: 'wallet',
    title: 'Link a wallet',
    byline: 'Connect a Web3 wallet to sign and pay onchain. Optional.',
    skippable: true,
  },
  {
    id: 'consent',
    title: 'Data sharing',
    byline: 'Choose whether to share usage data to improve the products.',
    // NOT skippable: an unanswered question is not permission, so skipping would
    // record nothing and leave the account in the state that means "still ask".
    // The step is satisfied by ANSWERING — either answer — not by acting.
    skippable: false,
  },
] as const

/** A minimal org reference the UI lists in the "choose org" step. */
export interface OrgRef {
  /** IAM org slug (the `<org>` in `<org>-<app>`). */
  readonly name: string
  /** Human-facing name; falls back to `name` when unset. */
  readonly displayName: string
}

/** A minimal project reference returned after creation. */
export interface ProjectRef {
  readonly owner: string
  readonly name: string
  readonly displayName: string
  readonly organization: string
}

/**
 * Accumulated flow state. Each step writes its result here; the success
 * screen and `onComplete` read it. Serializable so the host can persist a
 * resume point if it wants (this pkg does not persist on its own).
 */
export interface OnboardingState {
  /** Slug of the org the user landed in (chosen or created). */
  readonly orgName?: string
  /** Whether the org was freshly created in this flow (vs. pre-existing). */
  readonly orgCreated?: boolean
  /** Name of the project created in step 2, if any. */
  readonly projectName?: string
  /** Wallet address linked in step 3, if any. */
  readonly walletAddress?: string
  /** The consent record as IAM recorded it in step 4, if it was answered. */
  readonly consent?: ConsentRecord
}

/** Resolve a step descriptor by id. */
export function stepById(id: StepId): StepDesc | undefined {
  return STEPS.find((s) => s.id === id)
}

/** The step that follows `id` in the linear flow (`done` is terminal). */
export function nextStep(id: StepId): StepId {
  if (id === 'done') return 'done'
  const i = STEPS.findIndex((s) => s.id === id)
  if (i < 0 || i + 1 >= STEPS.length) return 'done'
  return STEPS[i + 1]!.id
}

/** The step that precedes `id`, or undefined at the first step. */
export function prevStep(id: StepId): StepId | undefined {
  const i = STEPS.findIndex((s) => s.id === id)
  if (i <= 0) return undefined
  return STEPS[i - 1]!.id
}
