import { useId, useState } from 'react'
import { EyeIcon, EyeOffIcon } from './icons'

/**
 * The ONE password field. Every credential this portal collects is typed into
 * this component, so "can I see what I typed" is answered in one place rather
 * than per form.
 *
 * A masked field with no way to unmask is the single most common cause of a
 * failed sign-in that looks like a wrong password, and it is worst exactly where
 * typing is least reliable: a phone keyboard, one glyph at a time, with
 * autocorrect and a shifted layout in the way. On signup it is worse still — the
 * account is CREATED with whatever was actually typed, so a typo behind the dots
 * locks the user out of an account they believe they just made.
 *
 * The reveal is the user's call, not ours. It defaults to masked, so nothing
 * about the resting page changes; unmasking is a deliberate act with the eye
 * open as its own state indicator.
 */
export interface PasswordFieldProps {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  /**
   * `current-password` on sign-in, `new-password` on registration. It is what
   * lets a password manager fill the right thing, and getting it wrong is how a
   * manager offers to "update" a saved credential during a fresh signup.
   */
  readonly autoComplete: 'current-password' | 'new-password'
  readonly minLength?: number
  /** The submit failed, so the control is part of what the person must fix. */
  readonly invalid?: boolean
  /** Id of the {@link Alert} describing that failure. */
  readonly describedBy?: string
}

export function PasswordField(props: PasswordFieldProps) {
  const [shown, setShown] = useState(false)
  const id = useId()
  return (
    <div className="hanzo-id-field">
      {/* A <label> wrapping the control is the idiom everywhere else here, but a
          <button> inside a <label> is activated twice — once as the button, once
          as the label forwarding to its control — so the toggle would fight
          itself. `htmlFor` keeps the same click-the-text-to-focus behaviour with
          the button safely outside. */}
      <label htmlFor={id}>{props.label}</label>
      <div className="hanzo-id-reveal">
        <input
          id={id}
          className="hanzo-id-input"
          type={shown ? 'text' : 'password'}
          autoComplete={props.autoComplete}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          minLength={props.minLength}
          aria-invalid={props.invalid || undefined}
          aria-describedby={props.describedBy}
          required
        />
        <button
          // NOT a submit. A bare <button> in a <form> defaults to type=submit,
          // so without this, revealing the password would submit the form.
          type="button"
          className="hanzo-id-revealbtn"
          // The control is a toggle, so it says what it DOES and reports its
          // state separately; a label that flips between "Show"/"Hide" makes
          // screen readers announce a change of control rather than of state.
          aria-label="Show password"
          aria-pressed={shown}
          aria-controls={id}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? <EyeOffIcon width={20} height={20} /> : <EyeIcon width={20} height={20} />}
        </button>
      </div>
    </div>
  )
}
