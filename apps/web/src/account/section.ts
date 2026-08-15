/**
 * Which section of the account surface an address names.
 *
 * A pure fact about a string, so it lives apart from the page that renders it —
 * the page imports the shared chrome, and a function this small should not have
 * to be loaded through a header to be checked.
 */

export const SECTIONS = [
  { id: '', label: 'Profile' },
  { id: 'security', label: 'Security' },
  { id: 'organizations', label: 'Organizations' },
  { id: 'apps', label: 'Applications' },
] as const

export type SectionId = (typeof SECTIONS)[number]['id']

/** `/account/security` → `security`; `/account` and anything unknown → profile. */
export function sectionOf(pathname: string): SectionId {
  const seg = pathname.replace(/^\/account\/?/, '').split('/')[0] ?? ''
  return (SECTIONS.find((s) => s.id === seg)?.id ?? '') as SectionId
}
