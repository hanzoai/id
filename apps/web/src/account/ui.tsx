import type { ReactNode } from 'react'

/**
 * The settings vocabulary: a Section holds Rows, a Row is a label and a value.
 *
 * Every screen in this folder is built from these three and nothing else, so a
 * spacing or type decision is made once. Same rule the stylesheet states — the
 * surface is keyed to a CLASS the component carries, never to where it sits.
 */

export function Section({
  title,
  describe,
  actions,
  children,
}: {
  title: string
  describe?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="hanzo-id-card">
      <header className="hanzo-id-card-head">
        <div>
          <h2 className="hanzo-id-card-title">{title}</h2>
          {describe ? <p className="hanzo-id-card-desc">{describe}</p> : null}
        </div>
        {actions ? <div className="hanzo-id-card-actions">{actions}</div> : null}
      </header>
      <div className="hanzo-id-card-body">{children}</div>
    </section>
  )
}

/** A label and its value. `control` puts an affordance at the end of the line. */
export function Row({
  label,
  hint,
  children,
  control,
}: {
  label: string
  hint?: string
  children?: ReactNode
  control?: ReactNode
}) {
  return (
    <div className="hanzo-id-row">
      <div className="hanzo-id-row-label">
        <span>{label}</span>
        {hint ? <small>{hint}</small> : null}
      </div>
      <div className="hanzo-id-row-value">{children}</div>
      {control ? <div className="hanzo-id-row-control">{control}</div> : null}
    </div>
  )
}

/** A value the account carries but nothing here can change. */
export function Fixed({ value, absent = 'Not set' }: { value: string; absent?: string }) {
  return value ? <span>{value}</span> : <span className="hanzo-id-absent">{absent}</span>
}

/** Loading, empty and failed all say so rather than rendering an empty box. */
export function Busy({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="hanzo-id-state" role="status">
      {label}
    </p>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="hanzo-id-state">{children}</p>
}

/** A short outcome line — the counterpart to Alert, for the good news. */
export function Done({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p className="hanzo-id-done" role="status">
      {message}
    </p>
  )
}

/** A badge for a role, a state, a channel. */
export function Tag({ children }: { children: ReactNode }) {
  return <span className="hanzo-id-tag">{children}</span>
}

/**
 * A switch, and the touch target that belongs to it.
 *
 * The checkbox itself is 18px because that is the size it reads at; the
 * stylesheet's note says its target is "the whole <label> row", which is true
 * wherever one wraps it and false where the control sits alone in a row. This
 * IS that label, so the rule holds everywhere rather than everywhere it was
 * remembered. `label` names the control for a screen reader, which the row's
 * own text cannot do — it is not associated with it.
 */
export function Toggle({
  checked,
  busy,
  label,
  onChange,
}: {
  checked: boolean
  busy?: boolean
  label: string
  onChange: (next: boolean) => void
}) {
  return (
    <label className="hanzo-id-toggle">
      <input
        type="checkbox"
        className="hanzo-id-check"
        checked={checked}
        aria-busy={busy}
        aria-label={label}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
    </label>
  )
}
