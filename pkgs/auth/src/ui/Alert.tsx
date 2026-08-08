/**
 * The ONE error region a form announces into.
 *
 * It replaces seventeen copies of `{error ? <p role="alert">…</p> : null}`, and
 * the copies were wrong in the same two ways every time.
 *
 * It RESTS in the document. Creating an assertive region and its text in the same
 * tick is the unreliable case for screen readers; a region that is already there
 * and whose text changes is the case they all handle. It also means the id below
 * always resolves, which is what lets a field point at the message describing it
 * (`aria-describedby`) instead of a message floating unattached in the page.
 * Empty, it is `display:none` — no box, no gap, nothing to see.
 *
 * `id` is required for exactly that reason: an error nobody can point at is an
 * error the person cannot associate with the control that caused it (WCAG 1.3.1),
 * and a control not marked `aria-invalid` is an error they are never told about at
 * all (3.3.1). This portal had zero uses of either attribute.
 */
export interface AlertProps {
  /** Stable id the describing controls point at — `useId()` in the caller. */
  readonly id: string
  /** The message, or null when there is none. */
  readonly message: string | null
}

export function Alert({ id, message }: AlertProps) {
  return (
    <p id={id} role="alert" className="hanzo-id-error">
      {message ?? ''}
    </p>
  )
}
