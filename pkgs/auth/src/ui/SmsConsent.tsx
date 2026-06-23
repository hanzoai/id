// Canonical A2P 10DLC consent copy. This EXACT disclosure is reused at every
// point where Hanzo collects or uses a phone number for messaging. It MUST stay
// verbatim-identical to the public opt-in page (hanzo.ai/sms-opt-in,
// `SMS_CONSENT_TEXT`) and to the IAM phone-login UI — Twilio / carrier campaign
// review compares the wording across surfaces. One string, reused everywhere.
export const SMS_CONSENT_TEXT =
  'I agree to receive text messages (SMS) from Hanzo AI at the number provided, ' +
  'including one-time passcodes and two-factor authentication, account and security ' +
  'alerts, and transactional notifications. Message frequency varies. Message and data ' +
  'rates may apply. Reply STOP to opt out at any time, or HELP for help. Consent is not ' +
  'a condition of any purchase.'

const TERMS_URL = 'https://hanzo.ai/terms'
const PRIVACY_URL = 'https://hanzo.ai/privacy'

/**
 * SMS consent disclosure shown beneath any phone/SMS surface (disclosure-only,
 * no checkbox — the portal's SMS step is reached only after the user already
 * provided/opted-in their number in IAM, and after a code was sent).
 *
 * For a phone-number COLLECTION surface that requires affirmative opt-in (A2P),
 * gate the submit on a checkbox and reuse {@link SMS_CONSENT_TEXT} — see the IAM
 * SignupPage `SmsConsentCheckbox`. The portal does not yet render its own phone
 * field (collection happens in the IAM-hosted UI), so only the notice is used
 * here today.
 */
export function SmsConsentNotice() {
  return (
    <div className="hanzo-id-sms-consent" role="note">
      <p>{SMS_CONSENT_TEXT}</p>
      <p className="hanzo-id-sms-consent-links">
        By continuing, you agree to our{' '}
        <a href={TERMS_URL} target="_blank" rel="noreferrer">Terms of Service</a> and{' '}
        <a href={PRIVACY_URL} target="_blank" rel="noreferrer">Privacy Policy</a>.
      </p>
    </div>
  )
}
