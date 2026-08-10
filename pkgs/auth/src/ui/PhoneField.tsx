import { useMemo, useState } from 'react'
import { AsYouType, getCountries, getCountryCallingCode, type CountryCode } from 'libphonenumber-js/min'

/**
 * A phone number, entered the way the person who owns it writes it.
 *
 * Two controls, because they answer two questions: WHICH country, then the number
 * as it is written THERE. A single field cannot do the second — (913) 777-9708 and
 * 07911 123456 and 090-1234-5678 are the same amount of number in three countries,
 * and a field that groups them all the American way tells two thirds of the world
 * it does not know where they live.
 *
 * The grouping is libphonenumber's, not ours. 245 countries' rules are a library,
 * not a regex we were going to get right, and `AsYouType` also handles the partial
 * case that matters most — it formats while you are still typing, so the number
 * settles into shape rather than jumping when it is finished.
 *
 * The names are `Intl.DisplayNames`, so they arrive in the reader's own language
 * and we ship no country table at all. A runtime without it (or a region code it
 * does not know) falls back to the ISO code, which is still identifiable.
 *
 * What is SHOWN and what is SENT are different strings, and only the second one
 * matters to IAM — see `compose`, which is where the trunk prefix is dealt with.
 */

/**
 * What gets SENT: the number in international form, which is not the dial code
 * glued to what was typed.
 *
 * Most of the world writes a trunk prefix that exists only inside the country —
 * GB 07911 123456, DE 01511…, FR 06…, JP 090… — and it is DROPPED when the country
 * code leads. Concatenating gives `+44 07911 123456`, which is not that number;
 * normalised it reads 44079111… against a stored 447911…, and the account is never
 * found. Every country with a trunk prefix would have failed, which is everywhere
 * except the NANP — where concatenation happens to be right, and where this was
 * tested.
 *
 * So libphonenumber composes it, the same library that formats it. Mid-typing
 * there is nothing to parse yet, and the dial code plus the digits so far is the
 * honest intermediate — it is never submitted, because a partial number does not
 * resolve either way.
 *
 * This is not a second normaliser. IAM's `GetUserByPhone` still normalises what it
 * receives; this only writes the number the way the number is written.
 */
function compose(typing: AsYouType, country: CountryCode, national: string): string {
  if (national.trim() === '') return ''
  const parsed = typing.getNumber()
  return parsed ? parsed.formatInternational() : `+${getCountryCallingCode(country)} ${national}`
}

/**
 * Where the browser says it is. A phone field that opens on the wrong country is
 * a wrong dial code on every number typed into it, and the region is already
 * stated in the locale — no lookup, no request.
 */
function here(): CountryCode {
  const known = new Set<string>(getCountries())
  for (const tag of typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]) {
    const region = new Intl.Locale(tag).maximize().region
    if (region && known.has(region)) return region as CountryCode
  }
  return 'US'
}

export function PhoneField({
  label,
  onChange,
  invalid,
  describedBy,
}: {
  readonly label: string
  readonly onChange: (identifier: string) => void
  readonly invalid?: boolean
  readonly describedBy?: string
}) {
  const [country, setCountry] = useState<CountryCode>(here)
  const [national, setNational] = useState('')

  // Sorted by NAME in the reader's language, so the list reads alphabetically to
  // the person using it rather than to the ISO registry.
  const countries = useMemo(() => {
    let name: (c: string) => string
    try {
      const names = new Intl.DisplayNames(undefined, { type: 'region' })
      name = (c) => names.of(c) ?? c
    } catch {
      name = (c) => c
    }
    return getCountries()
      .map((c) => ({ code: c, name: name(c), dial: getCountryCallingCode(c) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [])

  // Re-group under whichever country's rules apply. Digits that are not a number
  // in that country come back ungrouped, which is the truth about them — a US
  // number does not become a British one by choosing GB.
  function regroup(to: CountryCode, digits: string) {
    const typing = new AsYouType(to)
    const shown = typing.input(digits.replace(/[^\d+]/g, ''))
    setNational(shown)
    onChange(compose(typing, to, shown))
  }

  function pick(next: CountryCode) {
    setCountry(next)
    // Keep what was typed: choosing the country AFTER starting is exactly what
    // someone does when the default was wrong, and clearing the field punishes it.
    regroup(next, national)
  }

  return (
    <div className="hanzo-id-phone">
      <label className="hanzo-id-field">
        <span>Country</span>
        <select
          className="hanzo-id-input"
          data-phone-country={country}
          value={country}
          onChange={(e) => pick(e.target.value as CountryCode)}
        >
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name} (+{c.dial})
            </option>
          ))}
        </select>
      </label>
      <label className="hanzo-id-field">
        <span>{label}</span>
        {/* The dial code is shown, not typed: it belongs to the country chosen
            above, so an editable copy of it is a second place to get it wrong. */}
        <div className="hanzo-id-phone-number">
          <span className="hanzo-id-dial" aria-hidden="true">
            +{getCountryCallingCode(country)}
          </span>
          <input
            className="hanzo-id-input"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            data-phone-national="true"
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            value={national}
            onChange={(e) => regroup(country, e.target.value)}
            required
          />
        </div>
      </label>
    </div>
  )
}
