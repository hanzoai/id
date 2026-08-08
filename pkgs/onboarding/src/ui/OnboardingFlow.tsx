import { useCallback, useEffect, useReducer, useState, type FormEvent, type ReactNode } from 'react'
import {
  STEPS,
  nextStep,
  stepById,
  type OnboardingState,
  type PlanInfo,
  type StepId,
} from '../domain/types'
import { move, reachable, start } from '../domain/flow'
import { suggestOrgName, suggestProjectName } from '../domain/suggest'
import type { OnboardingService } from '../service/onboarding'

/**
 * Post-login onboarding flow.
 *
 * A self-contained five-step wizard (org → project → wallet → consent → plan)
 * driven by the domain step machine in `../domain/flow` — no router lib,
 * consistent with the rest of the portal which routes on `window.location` and
 * keeps page-local state in React. The host renders this once after login and
 * gets the accumulated {@link OnboardingState} back via `onComplete`.
 *
 * The machine lives in the domain rather than here because its rules are what
 * needs testing: which step is outstanding, and what a person may skip past.
 * This file is the rendering, and holds no rule of its own.
 *
 * White-label: all copy comes from the domain `STEPS` table + the `brandName`
 * prop. No brand-specific strings live in this component. Styling reuses the
 * portal's `hanzo-id-*` classes (defined in the web app's app.css).
 */
export interface OnboardingFlowProps {
  readonly service: OnboardingService
  /** Brand display name for headings (e.g. the resolved org brand). */
  readonly brandName: string
  /**
   * Where to open, from what the ACCOUNT already answers — the host reads it
   * with `service.readOnboarding()` and shapes it with `resume()`. Absent means
   * a brand-new account, which opens at step 1.
   *
   * Nothing is persisted in the browser, so a refresh or a second sign-in lands
   * wherever the account says, not back at the beginning.
   */
  readonly initial?: { readonly answered: readonly StepId[]; readonly data: OnboardingState }
  /**
   * Host-supplied wallet binding: prove a wallet and attach it to the account,
   * resolving to the bound address, or null if the person cancels. Kept as a
   * prop so this pkg stays free of any specific wallet library — the host owns
   * the connectors and the CAIP-122 round-trip. When omitted, the wallet step
   * shows a "not available" note and can only be skipped.
   *
   * It binds rather than merely connecting, because an address on its own proves
   * nothing: anyone can type one. The step used to take a bare address and post
   * it to a user field that does not exist, so it reported success and stored
   * nothing.
   */
  readonly bindWallet?: () => Promise<string | null>
  /** Called once the flow reaches `done`, with the final accumulated state. */
  readonly onComplete: (state: OnboardingState) => void
  /**
   * Pay origin serving the billing catalog (GET /v1/billing/plans). The plan
   * step renders the catalog's own prices — no price is stated here.
   */
  readonly payUrl: string
}

export function OnboardingFlow({
  service,
  brandName,
  initial,
  bindWallet,
  onComplete,
  payUrl,
}: OnboardingFlowProps) {
  const [flow, dispatch] = useReducer(move, initial, (i) => start(i?.answered, i?.data))

  // Terminal step: hand the accumulated state back to the host exactly once.
  useEffect(() => {
    if (flow.step === 'done') onComplete(flow.data)
  }, [flow.step, flow.data, onComplete])

  // The ONE way past a step: its own submit, carrying what it recorded.
  const answer = useCallback((patch: Partial<OnboardingState>) => dispatch({ kind: 'answer', patch }), [])
  const back = useCallback(() => dispatch({ kind: 'back' }), [])
  const goTo = useCallback((step: StepId) => dispatch({ kind: 'goTo', step }), [])

  const desc = stepById(flow.step)
  const stepIndex = STEPS.findIndex((s) => s.id === flow.step)

  /**
   * ← / → move between steps, so the whole flow is clickable OR keyboard-able.
   *
   * They NAVIGATE and nothing more. → used to dispatch the same move a submit
   * did, so it walked past consent and plan without either one writing, and from
   * the plan step reached the end with no completion recorded. It now asks to go
   * to the next step, which the machine grants only if that step is already
   * within reach.
   *
   * Ignored while the focus is in a text field, where the arrows move the
   * caret — stealing them there would make the org name box unusable. Also
   * ignored with a modifier held, which belongs to the browser (⌘← is Back).
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      e.preventDefault()
      if (e.key === 'ArrowLeft') back()
      else goTo(nextStep(flow.step))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [back, goTo, flow.step])

  return (
    <div className="hanzo-id-onboarding">
      {flow.step !== 'done' && desc ? (
        <>
          <StepDots active={stepIndex} answered={flow.answered} onGoTo={goTo} />
          <header className="hanzo-id-onboarding-head">
            <h1>{desc.title}</h1>
            <p className="lede">{desc.byline}</p>
          </header>
        </>
      ) : null}

      {flow.step === 'org' ? (
        <OrgStep service={service} orgName={flow.data.orgName} onNext={answer} />
      ) : null}
      {flow.step === 'project' ? (
        <ProjectStep
          service={service}
          orgName={flow.data.orgName}
          onNext={answer}
        />
      ) : null}
      {flow.step === 'wallet' ? (
        <WalletStep
          bindWallet={bindWallet}
          onNext={answer}
        />
      ) : null}
      {flow.step === 'consent' ? (
        <ConsentStep service={service} agreed={flow.data.dataSharingConsent} onNext={answer} />
      ) : null}
      {flow.step === 'plan' ? (
        <PlanStep service={service} payUrl={payUrl} onNext={answer} />
      ) : null}
      {flow.step === 'done' ? <DoneStep brandName={brandName} data={flow.data} /> : null}
    </div>
  )
}

/**
 * The progress bar IS the navigation — every segment that is within reach is a
 * real button that jumps to its step.
 *
 * It was a `role="progressbar"` of `aria-hidden` spans: it showed where you
 * were and offered no way to act on it, so getting back to a step you had
 * passed meant walking the whole flow again. A tablist says what it now does —
 * these select a view — and gives screen readers the same affordance the
 * pointer gets. Nothing here is a progress READOUT any more, so the
 * progressbar role would have been a lie.
 *
 * A step beyond the frontier is `disabled`, not hidden: the flow's length stays
 * visible, and a click cannot skip a step's write. Clicking one used to jump
 * straight past a required screen.
 */
function StepDots({
  active,
  answered,
  onGoTo,
}: {
  active: number
  answered: readonly StepId[]
  onGoTo: (id: StepId) => void
}) {
  return (
    <div className="hanzo-id-stepdots" role="tablist" aria-label="Onboarding steps">
      {STEPS.map((s, i) => (
        <button
          key={s.id}
          type="button"
          role="tab"
          aria-selected={i === active}
          aria-label={`Step ${i + 1} of ${STEPS.length}: ${s.title}`}
          className={i <= active ? 'on' : ''}
          disabled={!reachable(answered, s.id)}
          onClick={() => onGoTo(s.id)}
        />
      ))}
    </div>
  )
}

/**
 * The action row every step shares: Skip on the left, the step's own action on
 * the right. Left is ALWAYS Skip and right is ALWAYS the action, so the whole
 * flow is one target to click and the buttons never trade places under the
 * cursor. Going back is the step bar and the arrow keys.
 *
 * Skip renders from the step's DECLARATION, so the `STEPS` table is the one place
 * that decides whether a step may be passed without answering it. Each step used
 * to draw its own row, and the org step drew a Skip while declaring itself
 * required — the declaration lost, a test asserted a property the UI broke, and
 * skipping dropped the org for every step after it.
 *
 * `onSkip` is stated even by a step that offers no Skip: it says what skipping
 * WOULD do, so flipping a step's `skippable` in the table is the whole change.
 */
function Actions({
  step,
  busy,
  onSkip,
  children,
}: {
  step: StepId
  busy?: boolean
  onSkip: () => void
  children?: ReactNode
}) {
  return (
    <div className="hanzo-id-onboarding-actions">
      {stepById(step)?.skippable ? (
        <button type="button" className="hanzo-id-btn ghost" onClick={onSkip} disabled={busy}>
          Skip
        </button>
      ) : null}
      {children}
    </div>
  )
}

// ── Step 1: organization ────────────────────────────────────────────

function OrgStep({
  service,
  orgName,
  onNext,
}: {
  service: OnboardingService
  orgName?: string
  onNext: (patch: Partial<OnboardingState>) => void
}) {
  // Suggested once per mount, never re-rolled on re-render: a name that changed
  // under the cursor while you were reading it would be worse than a blank box.
  const [displayName, setDisplayName] = useState(suggestOrgName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(e: FormEvent) {
    e.preventDefault()
    const name = slugify(displayName)
    if (!name) {
      setError('Enter an organization name.')
      return
    }
    setBusy(true)
    setError(null)
    const res = await service.createOrg({ name, displayName: displayName.trim() })
    setBusy(false)
    if (!res.ok) {
      setError(humanizeError(res.error))
      return
    }
    onNext({ orgName: res.value.name, orgCreated: true })
  }

  // The account already has its org, so show it rather than a create box. IAM
  // gives an account ONE org and answers a request for a second with 409 — which
  // this screen rendered as "That name is taken. Try a different one.", so a
  // person passing back through here met a form where no name could ever work.
  if (orgName) {
    return (
      <div className="hanzo-id-onboarding-body">
        <p className="hanzo-id-info">
          You’re in <strong>{orgName}</strong>. Additional organizations are added
          by invitation.
        </p>
        <div className="hanzo-id-onboarding-actions">
          <button type="button" className="hanzo-id-btn" onClick={() => onNext({ orgName })}>
            Continue
          </button>
        </div>
      </div>
    )
  }

  // Onboarding never lists other orgs' organizations — a brand-new user only
  // ever creates their own org. Listing the org directory would leak every org's
  // name to anyone who signs up. Joining an existing org happens by invitation,
  // handled outside this flow.
  return (
    <div className="hanzo-id-onboarding-body">
      <form onSubmit={create} className="hanzo-id-form" aria-busy={busy}>
        <label className="hanzo-id-field">
          <span>Organization name</span>
          <input
            className="hanzo-id-input"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Acme Inc"
            autoFocus
            required
          />
        </label>
        {displayName ? <p className="hanzo-id-slug-preview">slug: {slugify(displayName) || '—'}</p> : null}
        {error ? <p role="alert" className="hanzo-id-error">{error}</p> : null}
        <Actions step="org" busy={busy} onSkip={() => onNext({})}>
          <button type="submit" className="hanzo-id-btn" disabled={busy}>
            {busy ? 'Creating…' : 'Continue'}
          </button>
        </Actions>
      </form>
    </div>
  )
}

// ── Step 2: project (optional) ──────────────────────────────────────

function ProjectStep({
  service,
  orgName,
  onNext,
}: {
  service: OnboardingService
  orgName?: string
  onNext: (patch: Partial<OnboardingState>) => void
}) {
  // Derived from the org, so the two naming steps read as one decision and
  // Continue is always a legal move: `acme-inc` -> `acme-inc-site`.
  const [displayName, setDisplayName] = useState(() => suggestProjectName(orgName))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(e: FormEvent) {
    e.preventDefault()
    if (!orgName) return // can't create a project without a home org
    const name = slugify(displayName)
    if (!name) {
      setError('Enter a project name.')
      return
    }
    setBusy(true)
    setError(null)
    const res = await service.createProject({ organization: orgName, name, displayName: displayName.trim() })
    setBusy(false)
    if (!res.ok) {
      setError(humanizeError(res.error))
      return
    }
    onNext({ projectName: res.value.name })
  }

  // No org was chosen (org step skipped) — a project needs a home org, so
  // offer only to continue.
  if (!orgName) {
    return (
      <div className="hanzo-id-onboarding-body">
        <p className="hanzo-id-info">Choose an organization first to create a project. You can do this later.</p>
        {/* The one place with a single control: with no org there is no project
            to create, so Skip and Continue would be the same button twice. */}
        <div className="hanzo-id-onboarding-actions">
          <button type="button" className="hanzo-id-btn" onClick={() => onNext({})}>
            Continue
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="hanzo-id-onboarding-body">
      <form onSubmit={create} className="hanzo-id-form" aria-busy={busy}>
        <label className="hanzo-id-field">
          <span>Project name</span>
          <input
            className="hanzo-id-input"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Production"
            autoFocus
          />
        </label>
        {displayName ? <p className="hanzo-id-slug-preview">slug: {slugify(displayName) || '—'}</p> : null}
        {error ? <p role="alert" className="hanzo-id-error">{error}</p> : null}
        <Actions step="project" busy={busy} onSkip={() => onNext({})}>
          <button type="submit" className="hanzo-id-btn" disabled={busy}>
            {busy ? 'Creating…' : 'Continue'}
          </button>
        </Actions>
      </form>
    </div>
  )
}

// ── Step 3: wallet (optional) ───────────────────────────────────────

function WalletStep({
  bindWallet,
  onNext,
}: {
  bindWallet?: () => Promise<string | null>
  onNext: (patch: Partial<OnboardingState>) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The host does the whole binding — challenge, signature, and the IAM write —
  // and answers with the address IAM actually recorded. So the address shown on
  // the summary is one the account really holds; this step no longer reports a
  // link it did not make.
  async function bind() {
    if (!bindWallet) return
    setBusy(true)
    setError(null)
    try {
      const address = await bindWallet()
      setBusy(false)
      if (!address) return // user cancelled the wallet prompt
      onNext({ walletAddress: address })
    } catch (e) {
      setBusy(false)
      // The message, not the Error's toString — "Error: …" is not for a reader.
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="hanzo-id-onboarding-body">
      {bindWallet ? null : (
        <p className="hanzo-id-info">Wallet linking isn’t available here. You can add one later in settings.</p>
      )}
      {error ? <p role="alert" className="hanzo-id-error">{error}</p> : null}
      {/* Named, not "Continue": linking a wallet opens the wallet's own approval
          UI to sign, which is not what "Continue" leads a person to expect. With
          no wallet available Skip is the only control, and it fills the row — the
          right-hand slot stays a button that does what it says. */}
      <Actions step="wallet" busy={busy} onSkip={() => onNext({})}>
        {bindWallet ? (
          <button type="button" className="hanzo-id-btn" onClick={bind} disabled={busy}>
            {busy ? 'Waiting for signature…' : 'Connect wallet'}
          </button>
        ) : null}
      </Actions>
    </div>
  )
}

// ── Step 4: data-sharing consent ────────────────────────────────────

function ConsentStep({
  service,
  agreed: stored,
  onNext,
}: {
  service: OnboardingService
  /** The account's stored answer, or undefined when it has never been asked. */
  agreed?: boolean
  onNext: (patch: Partial<OnboardingState>) => void
}) {
  // Seeded from the ACCOUNT's answer, so passing back through this screen shows
  // what the person actually said. The box was hard-coded unchecked and both
  // buttons wrote, so a second visit revoked a consent they had granted — a real
  // withdrawal, audited, attributed to someone who never asked for it.
  const [agreed, setAgreed] = useState(stored ?? false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Either answer continues; the answer itself is what must exist. It is
  // persisted on the USER (not browser storage) before the flow advances, so
  // this page is asked exactly once per account, ever.
  //
  // An unchanged answer writes nothing: re-confirming what the account already
  // says is not a new decision, and a write would put a fresh timestamp on an
  // old agreement.
  async function answer() {
    if (agreed === stored) {
      onNext({ dataSharingConsent: agreed })
      return
    }
    setBusy(true)
    setError(null)
    const res = await service.saveOnboarding({ consent: agreed })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    onNext({ dataSharingConsent: agreed })
  }

  return (
    <div className="hanzo-id-onboarding-body">
      <div className="hanzo-id-consent">
        <p>
          Sharing usage data helps improve the models and products you use. It
          covers product usage patterns and diagnostics — never the content of
          your conversations, code, or files. You can change this any time in
          account settings.
        </p>
        <label className="hanzo-id-consent-check">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span>I agree to share usage data to improve products and models.</span>
        </label>
      </div>
      {error ? <p role="alert" className="hanzo-id-error">{error}</p> : null}
      {/* ONE control. The box already carries both answers — unticked and
          Continue IS "no" — so a second button that also wrote was a second way
          to say the same thing, and on a re-entry it silently said the opposite
          of what the account held. */}
      <Actions step="consent" busy={busy} onSkip={answer}>
        <button type="button" className="hanzo-id-btn" onClick={answer} disabled={busy}>
          {busy ? 'Saving…' : 'Continue'}
        </button>
      </Actions>
    </div>
  )
}

// ── Step 5 (last): plan or pay-as-you-go ────────────────────────────

/** Format catalog CENTS as dollars — "$9" or "$8.25", never "$9.00". */
function usd(cents: number): string {
  const dollars = cents / 100
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`
}

function PlanStep({
  service,
  payUrl,
  onNext,
}: {
  service: OnboardingService
  payUrl: string
  onNext: (patch: Partial<OnboardingState>) => void
}) {
  const [plans, setPlans] = useState<PlanInfo[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    service.listPlans(payUrl).then((p) => {
      if (alive) setPlans(p)
    })
    return () => {
      alive = false
    }
    // payUrl is fixed for the page's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The choice is persisted (with completion) BEFORE the flow advances, so a
  // user who bounces off the payment page still never re-enters onboarding —
  // they land on the portal, where the top-up surface remains one click away.
  // `choice` is null when the step is skipped: no plan is recorded, but
  // completion still is. This is the LAST step, and `completedAt` is what stops
  // onboarding being re-entered — a skip that omitted it would loop the user
  // back into this flow on their next sign-in forever.
  async function choose(choice: string | null) {
    setBusy(choice ?? 'skip')
    setError(null)
    const res = await service.saveOnboarding({
      ...(choice ? { plan: choice } : {}),
      completedAt: new Date().toISOString(),
    })
    setBusy(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    onNext(choice ? { planChoice: choice } : {})
  }

  return (
    <div className="hanzo-id-onboarding-body">
      {plans === null ? (
        <p className="lede">Loading plans…</p>
      ) : (
        <div className="hanzo-id-plans" role="list">
          {plans.length === 0 ? (
            // The catalog fetch failed or came back empty. Say so — a plan
            // picker showing ONLY pay-as-you-go with no explanation reads as
            // "there are no plans", which is false. Pay as you go still works,
            // and plans remain choosable later from billing.
            <p role="alert" className="hanzo-id-plans-empty">
              Plans are unavailable right now — you can start with pay as you
              go and pick a plan later from Billing.
            </p>
          ) : null}
          {plans.map((p) => (
            <button
              key={p.slug}
              type="button"
              role="listitem"
              className={p.popular ? 'hanzo-id-plan popular' : 'hanzo-id-plan'}
              onClick={() => choose(p.slug)}
              disabled={busy !== null}
              aria-busy={busy === p.slug}
            >
              {p.popular ? <span className="hanzo-id-plan-badge">Popular</span> : null}
              <span className="hanzo-id-plan-name">{p.name}</span>
              <span className="hanzo-id-plan-price">
                {usd(p.priceCents)}/mo
                {p.priceAnnualCents ? <em> · {usd(p.priceAnnualCents * 12)}/yr billed annually</em> : null}
              </span>
              {p.description ? <span className="hanzo-id-plan-desc">{p.description}</span> : null}
            </button>
          ))}
          <button
            type="button"
            role="listitem"
            className="hanzo-id-plan payg"
            onClick={() => choose('payg')}
            disabled={busy !== null}
            aria-busy={busy === 'payg'}
          >
            <span className="hanzo-id-plan-name">Pay as you go</span>
            <span className="hanzo-id-plan-price">Prepaid balance · $5 minimum</span>
            <span className="hanzo-id-plan-desc">
              No subscription. Top up a balance and pay only for what you use.
            </span>
          </button>
        </div>
      )}
      {error ? <p role="alert" className="hanzo-id-error">{error}</p> : null}
      {/* The plan CARDS are this step's right-hand action, so Skip stands alone
          — picking a plan is a choice among several, not one Continue. It still
          records completion, which is what keeps a person who defers from being
          walked back through onboarding on their next sign-in. */}
      <Actions step="plan" busy={busy !== null} onSkip={() => choose(null)} />
    </div>
  )
}

// ── Terminal: success ───────────────────────────────────────────────

function DoneStep({ brandName, data }: { brandName: string; data: OnboardingState }) {
  return (
    <div className="hanzo-id-onboarding-done">
      <h1>You’re all set</h1>
      <p className="lede">Welcome to {brandName}.</p>
      <dl className="hanzo-id-summary">
        {data.orgName ? (
          <>
            <dt>Organization</dt>
            <dd>{data.orgName}</dd>
          </>
        ) : null}
        {data.projectName ? (
          <>
            <dt>Project</dt>
            <dd>{data.projectName}</dd>
          </>
        ) : null}
        {data.walletAddress ? (
          <>
            <dt>Wallet</dt>
            <dd>{shortAddr(data.walletAddress)}</dd>
          </>
        ) : null}
      </dl>
    </div>
  )
}

/**
 * Map raw IAM errors to a human sentence. Org/project creation is admin-gated
 * in IAM authz (`add-organization` requires the `admin` role; `add-project`
 * default-denies for non-admins), so a normal member hits a permission error
 * — say so plainly instead of leaking an HTTP code, and the step stays
 * skippable so onboarding never hard-blocks.
 */
function humanizeError(raw: string): string {
  const lower = raw.toLowerCase()
  if (lower.includes('403') || lower.includes('permission') || lower.includes('not allowed') || lower.includes('unauthorized')) {
    return 'You don’t have permission to create this here. Pick an existing organization, or ask an admin to invite you.'
  }
  if (lower.includes('already') || lower.includes('exist') || lower.includes('conflict') || lower.includes('409')) {
    return 'That name is taken. Try a different one.'
  }
  return raw
}

/** Lower-kebab a display name into an org/project slug. */
function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a
}
