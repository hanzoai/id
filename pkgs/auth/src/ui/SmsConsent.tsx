import { idBrandLabel, legal, type Brand, type Org } from '@hanzo/id-shared'

/**
 * Canonical A2P 10DLC consent copy, naming the company that sends the messages.
 * Apart from the sender the wording is fixed: it must match the brand's public
 * opt-in page and the IAM phone-login UI word for word, because carrier campaign
 * review compares the disclosure across surfaces.
 */
export function smsConsentText(sender: string): string {
  return (
    `I agree to receive text messages (SMS) from ${sender} at the number provided, ` +
    'including one-time passcodes and two-factor authentication, account and security ' +
    'alerts, and transactional notifications. Message frequency varies. Message and data ' +
    'rates may apply. Reply STOP to opt out at any time, or HELP for help. Consent is not ' +
    'a condition of any purchase.'
  )
}

/**
 * The sender a host's messages name: the org's company without its corporate
 * suffix ("Lux Industries Inc" reads "Lux Industries"), or the brand's own
 * name when the org declares no company.
 */
export function smsSender(brand: Brand, org: Pick<Org, 'orgId'>): string {
  const { company } = legal(brand, org)
  if (company) return company.replace(/,?\s+Inc\.?$/, '')
  return idBrandLabel(brand, org.orgId).replace(/\s+ID$/, '')
}

/**
 * SMS consent disclosure shown beneath any phone/SMS surface (disclosure-only,
 * no checkbox — the portal's SMS step is reached only after the user already
 * provided/opted-in their number in IAM, and after a code was sent).
 *
 * Everything in it belongs to the host's brand: the sender, and the terms and
 * privacy links the org publishes. A link the org does not publish is left out,
 * and with neither the sentence that introduces them goes too.
 *
 * For a phone-number COLLECTION surface that requires affirmative opt-in (A2P),
 * gate the submit on a checkbox and reuse {@link smsConsentText} — see the IAM
 * SignupPage `SmsConsentCheckbox`. The portal does not yet render its own phone
 * field (collection happens in the IAM-hosted UI), so only the notice is used
 * here today.
 */
export function SmsConsentNotice({ brand, org }: { brand: Brand; org: Org }) {
  const { terms, privacy } = legal(brand, org)
  return (
    <div className="id-sms-consent" role="note">
      <p>{smsConsentText(smsSender(brand, org))}</p>
      {terms || privacy ? (
        <p className="id-sms-consent-links">
          By continuing, you agree to our{' '}
          {terms ? (
            <a href={terms} target="_blank" rel="noreferrer">
              Terms of Service
            </a>
          ) : null}
          {terms && privacy ? ' and ' : null}
          {privacy ? (
            <a href={privacy} target="_blank" rel="noreferrer">
              Privacy Policy
            </a>
          ) : null}
          .
        </p>
      ) : null}
    </div>
  )
}
