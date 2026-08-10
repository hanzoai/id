import { useEffect, useMemo, useState } from 'react'
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
 * What the field opens on before anything is known. A phone field that opens on
 * the wrong country puts a wrong dial code on every number typed into it, so
 * this is the answer that must never be *silently* wrong — the edge refines it a
 * moment later (see the trace read in the component), and the picker overrides
 * both.
 */
function here(): CountryCode {
  // US, unconditionally. The locale is NOT where someone is, and this field is
  // where that stops being an academic point: `navigator.language` is the
  // language a browser was configured to display, so a Mac set to British
  // English opens +44 for a customer in California, and every number typed after
  // that carries the wrong dial code.
  //
  // Two readings of the tag were tried and both were wrong in production. The
  // first ran it through `Intl.Locale.maximize()`, which INFERS a region from a
  // language — a likely-subtags lookup, not a statement of location — so a bare
  // `en` landed on US only by luck. The second read the tag's OWN region, which
  // is honest about what it knows and still answers GB for `en-GB`, because that
  // string genuinely says British English and says nothing at all about where
  // the browser is.
  //
  // So the signal is dropped rather than refined. A default cannot be right for
  // everyone; it can be right for most, cheap to change, and never silently
  // wrong. The picker beside this field is how someone elsewhere says so in one
  // click, and the number is stored fully qualified either way.
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
  // Set once somebody touches the picker, so the async answer below can never
  // overwrite a choice a person made with their hands.
  const [chosen, setChosen] = useState(false)

  // WHERE THE REQUEST CAME FROM, which is the question the locale could not
  // answer. Cloudflare terminates every one of these hosts and publishes the
  // country it geolocated the client to at /cdn-cgi/trace — no key, no config, no
  // third party, same origin. It is a fact about the connection rather than about
  // the language a browser was configured to display.
  //
  // It REFINES the US default rather than replacing it: the field renders
  // immediately on +1 and moves only if the edge disagrees, so nobody watches a
  // dial code flicker on a slow network and nobody outside the US is stuck with a
  // wrong one. Silent on every failure — a zone that is DNS-only serves no trace
  // endpoint at all (zoolabs.id today), and a phone field must not care.
  useEffect(() => {
    let alive = true
    const known = new Set<string>(getCountries())
    fetch('/cdn-cgi/trace', { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : ''))
      .then((body) => {
        if (!alive || chosen) return
        const loc = /^loc=([A-Z]{2})$/m.exec(body)?.[1]
        if (loc && known.has(loc)) setCountry(loc as CountryCode)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
    // One shot on mount. `chosen` is read inside rather than depended on, so a
    // person picking a country cannot re-fire the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
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
    setChosen(true)
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
