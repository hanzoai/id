/** Labeled horizontal rule, e.g. "or", separating social from email sign-in. */
export function Divider({ label = 'or' }: { label?: string }) {
  return (
    <div className="hanzo-id-divider" role="separator" aria-label={label}>
      <span>{label}</span>
    </div>
  )
}
