import { useCallback, useEffect, useReducer, useState, type FormEvent } from 'react'
import {
  STEPS,
  nextStep,
  prevStep,
  stepById,
  type OnboardingState,
  type PlanInfo,
  type StepId,
} from '../domain/types'
import type { OnboardingService } from '../service/onboarding'

/**
 * Post-login onboarding flow.
 *
 * A self-contained three-step wizard (org → project → wallet) driven by an
 * internal step machine — no router lib, consistent with the rest of the
 * portal which routes on `window.location` and keeps page-local state in
 * React. The host renders this once after login and gets the accumulated
 * {@link OnboardingState} back via `onComplete`.
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
   * Host-supplied wallet connector. Returns the connected address (0x…) or
   * null if the user cancels. Kept as a prop so this pkg stays free of any
   * specific wallet library — the host wires Web3Onboard / wagmi / window
   * .ethereum. When omitted, the wallet step shows a "not available" note
   * and can only be skipped.
   */
  readonly connectWallet?: () => Promise<string | null>
  /** Called once the flow reaches `done`, with the final accumulated state. */
  readonly onComplete: (state: OnboardingState) => void
  /**
   * Pay origin serving the billing catalog (GET /v1/billing/plans). The plan
   * step renders the catalog's own prices — no price is stated here.
   */
  readonly payUrl: string
}

interface FlowState {
  readonly step: StepId
  readonly data: OnboardingState
}

type FlowAction =
  | { type: 'advance'; patch: Partial<OnboardingState> }
  | { type: 'back' }

function reducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case 'advance':
      return { step: nextStep(state.step), data: { ...state.data, ...action.patch } }
    case 'back': {
      const prev = prevStep(state.step)
      return prev ? { ...state, step: prev } : state
    }
  }
}

export function OnboardingFlow({ service, brandName, connectWallet, onComplete, payUrl }: OnboardingFlowProps) {
  const [state, dispatch] = useReducer(reducer, { step: 'org', data: {} })

  // Terminal step: hand the accumulated state back to the host exactly once.
  useEffect(() => {
    if (state.step === 'done') onComplete(state.data)
  }, [state.step, state.data, onComplete])

  const advance = useCallback((patch: Partial<OnboardingState>) => dispatch({ type: 'advance', patch }), [])
  const back = useCallback(() => dispatch({ type: 'back' }), [])

  const desc = stepById(state.step)
  const stepIndex = STEPS.findIndex((s) => s.id === state.step)
  const showBack = stepIndex > 0

  return (
    <div className="hanzo-id-onboarding">
      {state.step !== 'done' && desc ? (
        <>
          <StepDots active={stepIndex} total={STEPS.length} />
          <header className="hanzo-id-onboarding-head">
            <h1>{desc.title}</h1>
            <p className="lede">{desc.byline}</p>
          </header>
        </>
      ) : null}

      {state.step === 'org' ? (
        <OrgStep service={service} onNext={advance} />
      ) : null}
      {state.step === 'project' ? (
        <ProjectStep
          service={service}
          orgName={state.data.orgName}
          showBack={showBack}
          onBack={back}
          onNext={advance}
        />
      ) : null}
      {state.step === 'wallet' ? (
        <WalletStep
          service={service}
          connectWallet={connectWallet}
          showBack={showBack}
          onBack={back}
          onNext={advance}
        />
      ) : null}
      {state.step === 'consent' ? (
        <ConsentStep service={service} showBack={showBack} onBack={back} onNext={advance} />
      ) : null}
      {state.step === 'plan' ? (
        <PlanStep service={service} payUrl={payUrl} showBack={showBack} onBack={back} onNext={advance} />
      ) : null}
      {state.step === 'done' ? <DoneStep brandName={brandName} data={state.data} /> : null}
    </div>
  )
}

/** Linear progress dots. */
function StepDots({ active, total }: { active: number; total: number }) {
  return (
    <div className="hanzo-id-stepdots" role="progressbar" aria-valuenow={active + 1} aria-valuemax={total}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i <= active ? 'on' : ''} aria-hidden />
      ))}
    </div>
  )
}

// ── Step 1: organization ────────────────────────────────────────────

function OrgStep({
  service,
  onNext,
}: {
  service: OnboardingService
  onNext: (patch: Partial<OnboardingState>) => void
}) {
  const [displayName, setDisplayName] = useState('')
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

  // Onboarding never lists other orgs' organizations — a brand-new user only
  // ever creates their own org or skips. Listing the org directory would leak
  // every org's name to anyone who signs up. Joining an existing org happens
  // by invitation, handled outside this flow.
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
        <div className="hanzo-id-onboarding-actions">
          <button type="button" className="hanzo-id-btn ghost" onClick={() => onNext({})} disabled={busy}>
            Skip for now
          </button>
          <button type="submit" className="hanzo-id-btn" disabled={busy}>
            {busy ? 'Creating…' : 'Create organization'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Step 2: project (optional) ──────────────────────────────────────

function ProjectStep({
  service,
  orgName,
  showBack,
  onBack,
  onNext,
}: {
  service: OnboardingService
  orgName?: string
  showBack: boolean
  onBack: () => void
  onNext: (patch: Partial<OnboardingState>) => void
}) {
  const [displayName, setDisplayName] = useState('')
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
        <div className="hanzo-id-onboarding-actions">
          {showBack ? (
            <button type="button" className="hanzo-id-btn ghost" onClick={onBack}>
              Back
            </button>
          ) : null}
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
        <div className="hanzo-id-onboarding-actions">
          {showBack ? (
            <button type="button" className="hanzo-id-btn ghost" onClick={onBack}>
              Back
            </button>
          ) : null}
          <button type="button" className="hanzo-id-btn ghost" onClick={() => onNext({})} disabled={busy}>
            Skip
          </button>
          <button type="submit" className="hanzo-id-btn" disabled={busy}>
            {busy ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Step 3: wallet (optional) ───────────────────────────────────────

function WalletStep({
  service,
  connectWallet,
  showBack,
  onBack,
  onNext,
}: {
  service: OnboardingService
  connectWallet?: () => Promise<string | null>
  showBack: boolean
  onBack: () => void
  onNext: (patch: Partial<OnboardingState>) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function link() {
    if (!connectWallet) return
    setBusy(true)
    setError(null)
    try {
      const address = await connectWallet()
      if (!address) {
        setBusy(false)
        return // user cancelled the wallet prompt
      }
      const res = await service.linkWallet(address)
      setBusy(false)
      if (!res.ok) {
        setError(res.error)
        return
      }
      onNext({ walletAddress: res.value })
    } catch (e) {
      setBusy(false)
      setError(String(e))
    }
  }

  return (
    <div className="hanzo-id-onboarding-body">
      {connectWallet ? null : (
        <p className="hanzo-id-info">Wallet linking isn’t available here. You can add one later in settings.</p>
      )}
      {error ? <p role="alert" className="hanzo-id-error">{error}</p> : null}
      <div className="hanzo-id-onboarding-actions">
        {showBack ? (
          <button type="button" className="hanzo-id-btn ghost" onClick={onBack}>
            Back
          </button>
        ) : null}
        <button type="button" className="hanzo-id-btn ghost" onClick={() => onNext({})} disabled={busy}>
          Skip
        </button>
        {connectWallet ? (
          <button type="button" className="hanzo-id-btn" onClick={link} disabled={busy}>
            {busy ? 'Connecting…' : 'Connect wallet'}
          </button>
        ) : null}
      </div>
    </div>
  )
}

// ── Step 4: data-sharing consent ────────────────────────────────────

function ConsentStep({
  service,
  showBack,
  onBack,
  onNext,
}: {
  service: OnboardingService
  showBack: boolean
  onBack: () => void
  onNext: (patch: Partial<OnboardingState>) => void
}) {
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Either answer continues; the answer itself is what must exist. It is
  // persisted on the USER (not browser storage) before the flow advances, so
  // this page is asked exactly once per account, ever.
  async function answer() {
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
      <div className="hanzo-id-onboarding-actions">
        {showBack ? (
          <button type="button" className="hanzo-id-btn ghost" onClick={onBack} disabled={busy}>
            Back
          </button>
        ) : null}
        <button type="button" className="hanzo-id-btn" onClick={answer} disabled={busy}>
          {busy ? 'Saving…' : 'Continue'}
        </button>
      </div>
    </div>
  )
}

// ── Step 5 (last): plan or pay-as-you-go ────────────────────────────

function PlanStep({
  service,
  payUrl,
  showBack,
  onBack,
  onNext,
}: {
  service: OnboardingService
  payUrl: string
  showBack: boolean
  onBack: () => void
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
  async function choose(choice: string) {
    setBusy(choice)
    setError(null)
    const res = await service.saveOnboarding({
      plan: choice,
      completedAt: new Date().toISOString(),
    })
    setBusy(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    onNext({ planChoice: choice })
  }

  return (
    <div className="hanzo-id-onboarding-body">
      {plans === null ? (
        <p className="lede">Loading plans…</p>
      ) : (
        <div className="hanzo-id-plans" role="list">
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
              <span className="hanzo-id-plan-name">{p.name}</span>
              <span className="hanzo-id-plan-price">
                ${p.price}/mo
                {p.priceAnnual ? <em> · ${p.priceAnnual}/yr</em> : null}
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
      {showBack ? (
        <div className="hanzo-id-onboarding-actions">
          <button type="button" className="hanzo-id-btn ghost" onClick={onBack} disabled={busy !== null}>
            Back
          </button>
        </div>
      ) : null}
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
