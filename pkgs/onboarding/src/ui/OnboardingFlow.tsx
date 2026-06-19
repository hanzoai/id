import { useCallback, useEffect, useReducer, useState, type FormEvent } from 'react'
import {
  STEPS,
  nextStep,
  prevStep,
  stepById,
  type OnboardingState,
  type OrgRef,
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
  /** Brand display name for headings (e.g. the resolved tenant brand). */
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

export function OnboardingFlow({ service, brandName, connectWallet, onComplete }: OnboardingFlowProps) {
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
          orgName={state.data.orgName!}
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
  const [orgs, setOrgs] = useState<OrgRef[] | null>(null)
  const [mode, setMode] = useState<'pick' | 'create'>('pick')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    service.listOrgs().then((list) => {
      if (cancelled) return
      setOrgs(list)
      // No existing memberships → drop straight into create mode.
      if (list.length === 0) setMode('create')
    })
    return () => {
      cancelled = true
    }
  }, [service])

  async function pick(org: OrgRef) {
    onNext({ orgName: org.name, orgCreated: false })
  }

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
      setError(res.error)
      return
    }
    onNext({ orgName: res.value.name, orgCreated: true })
  }

  if (orgs === null) return <p className="hanzo-id-info">Loading your organizations…</p>

  return (
    <div className="hanzo-id-onboarding-body">
      {mode === 'pick' && orgs.length > 0 ? (
        <>
          <ul className="hanzo-id-org-list">
            {orgs.map((o) => (
              <li key={o.name}>
                <button type="button" className="hanzo-id-org-row" onClick={() => pick(o)}>
                  <span>{o.displayName}</span>
                  <span className="hanzo-id-org-slug">{o.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="hanzo-id-linkbtn" onClick={() => setMode('create')}>
            + Create a new organization
          </button>
        </>
      ) : (
        <form onSubmit={create} aria-busy={busy}>
          <label>
            <span>Organization name</span>
            <input
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
            {orgs.length > 0 ? (
              <button type="button" className="hanzo-id-btn ghost" onClick={() => setMode('pick')}>
                Back
              </button>
            ) : null}
            <button type="submit" className="hanzo-id-btn primary" disabled={busy}>
              {busy ? 'Creating…' : 'Create organization'}
            </button>
          </div>
        </form>
      )}
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
  orgName: string
  showBack: boolean
  onBack: () => void
  onNext: (patch: Partial<OnboardingState>) => void
}) {
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(e: FormEvent) {
    e.preventDefault()
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
      setError(res.error)
      return
    }
    onNext({ projectName: res.value.name })
  }

  return (
    <div className="hanzo-id-onboarding-body">
      <form onSubmit={create} aria-busy={busy}>
        <label>
          <span>Project name</span>
          <input
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
          <button type="submit" className="hanzo-id-btn primary" disabled={busy}>
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
          <button type="button" className="hanzo-id-btn primary" onClick={link} disabled={busy}>
            {busy ? 'Connecting…' : 'Connect wallet'}
          </button>
        ) : null}
      </div>
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
