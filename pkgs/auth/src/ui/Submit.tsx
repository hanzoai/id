/**
 * The ONE submit button, and the one place the "where did my focus go" bug is
 * fixed.
 *
 * Every form here disabled its submit while the request was in flight. A disabled
 * element cannot hold focus, so the browser blurred it to `<body>` — measured on
 * hanzo.id/login and hanzo.id/forget, `document.activeElement.tagName` was BODY
 * after a failed sign-in, both times. The person who pressed Enter was left
 * nowhere: the error was announced and unreachable, and getting back to the button
 * meant tabbing in from the top of the document.
 *
 * `aria-disabled` says the same thing to a screen reader without taking the
 * control out of the tab order, and re-entry is guarded where it belongs — in the
 * handler, which is the only place that knows a request is already running. The
 * stylesheet already dims `[aria-disabled='true']` and suppresses its hover.
 */
export interface SubmitProps {
  /** A request is in flight; the label changes and re-entry is refused. */
  readonly busy: boolean
  readonly label: string
  readonly busyLabel: string
  /**
   * A precondition the form has not met yet — a code with too few digits, say.
   * Reported like `busy` is, and never by removing the control.
   */
  readonly ready?: boolean
}

export function Submit({ busy, label, busyLabel, ready = true }: SubmitProps) {
  return (
    <button type="submit" className="hanzo-id-btn" aria-disabled={busy || !ready}>
      {busy ? busyLabel : label}
    </button>
  )
}
