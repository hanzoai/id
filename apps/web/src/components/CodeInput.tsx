import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react'

/**
 * Segmented code input — one box per character, the shape a person expects for a
 * short login/PIN code and the one the device-approval screen shows.
 *
 * Controlled: `value` is the WHOLE code (the device flow's own `user_code`
 * string, so the parent keeps owning it) and `onChange` gets the next whole code.
 * It normalizes toward the shape IAM mints (RFC 8628 §6.1: uppercased, the
 * unambiguous alphabet), so a pasted `k7m4-p2qh` lands as `K7M4P2QH` across eight
 * boxes with the separator dropped — IAM validates the exact alphabet.
 *
 * `onChange` (not `onKeyDown`) is the primary path so it also catches paste and
 * the browser's `one-time-code` autofill, which fill a value without a keystroke;
 * `onKeyDown` only carries the two things a value change cannot express —
 * backspace out of an already-empty box, and arrow navigation.
 */
const KEEP = /[A-Z0-9]/
const norm = (s: string) =>
  s.toUpperCase().split('').filter((c) => KEEP.test(c)).join('')

export function CodeInput({
  value,
  onChange,
  length = 8,
  disabled,
  autoFocus,
  ariaLabel = 'Login code',
}: {
  value: string
  onChange: (next: string) => void
  length?: number
  disabled?: boolean
  autoFocus?: boolean
  ariaLabel?: string
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const slots = value.padEnd(length, ' ').slice(0, length).split('')

  const focus = (i: number) => {
    const el = refs.current[Math.max(0, Math.min(length - 1, i))]
    el?.focus()
    el?.select()
  }

  // Write chars starting at box i (one from a keystroke, many from paste/autofill)
  // and advance to the box after the last one written.
  const write = (i: number, incoming: string) => {
    const next = value.padEnd(length, ' ').slice(0, length).split('')
    let k = 0
    for (; k < incoming.length && i + k < length; k++) next[i + k] = incoming[k]!
    onChange(next.join('').trimEnd())
    focus(Math.min(length - 1, i + Math.max(1, k) - 1) + 1)
  }

  const clearAt = (i: number) => {
    const next = value.padEnd(length, ' ').slice(0, length).split('')
    next[i] = ' '
    onChange(next.join('').trimEnd())
  }

  const onInput = (i: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = norm(e.target.value)
    if (!raw) return clearAt(i) // deletion or an invalid char typed
    write(i, raw)
  }

  const onKey = (i: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !slots[i]!.trim()) {
      // Empty box: step back and clear the one before it (a normal box's own
      // backspace is a value change, handled by onInput).
      e.preventDefault()
      clearAt(i - 1)
      focus(i - 1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focus(i - 1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      focus(i + 1)
    }
  }

  const onPaste = (i: number) => (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = norm(e.clipboardData.getData('text'))
    if (!pasted) return
    e.preventDefault()
    write(i, pasted)
  }

  return (
    <div className="hanzo-id-codeinput" role="group" aria-label={ariaLabel}>
      {slots.map((c, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`${ariaLabel} character ${i + 1} of ${length}`}
          className="hanzo-id-codebox"
          maxLength={1}
          value={c.trim()}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          onFocus={(e) => e.currentTarget.select()}
          onChange={onInput(i)}
          onKeyDown={onKey(i)}
          onPaste={onPaste(i)}
        />
      ))}
    </div>
  )
}
