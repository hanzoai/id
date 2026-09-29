/**
 * The SMS consent notice names the host's brand and links only that brand's own
 * legal pages. One image serves every identity host, so a sender or a link
 * written as a literal is one company's disclosure on every other company's
 * sign-in.
 */
import { afterEach, test } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, render } from '@testing-library/react'
import type { Brand, Org } from '@hanzo/id-shared'
import { SmsConsentNotice, smsConsentText, smsSender } from './SmsConsent'
import { OTPForm } from './OTPForm'

afterEach(cleanup)

function org(orgId: string, host: string, extra: Partial<Org> = {}): Org {
  return {
    orgId,
    iamUrl: `https://${host}`,
    iamIssuer: `https://${host}`,
    clientId: `${orgId}-console`,
    appName: `${orgId}-console`,
    publicOrigin: `https://${host}`,
    brandPackage: '',
    ...extra,
  }
}

const brand = (name: string) => ({ name, title: name, description: '', appDomain: '', logoUrl: '', faviconUrl: '' }) as Brand

function notice(b: Brand, o: Org) {
  const { container } = render(<SmsConsentNotice brand={b} org={o} />)
  const links = [...container.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])
  return { text: container.textContent ?? '', links }
}

// Hanzo's copy is the text registered with its carrier campaign; it stays byte
// for byte what the opt-in page says.
test('hanzo.id keeps its registered disclosure and both legal links', () => {
  assert.equal(
    smsConsentText(smsSender(brand('Hanzo'), { orgId: 'hanzo' })),
    'I agree to receive text messages (SMS) from Hanzo AI at the number provided, ' +
      'including one-time passcodes and two-factor authentication, account and security ' +
      'alerts, and transactional notifications. Message frequency varies. Message and data ' +
      'rates may apply. Reply STOP to opt out at any time, or HELP for help. Consent is not ' +
      'a condition of any purchase.',
  )
  const n = notice(brand('Hanzo'), org('hanzo', 'hanzo.id'))
  assert.deepEqual(n.links, [
    ['Terms of Service', 'https://hanzo.ai/terms'],
    ['Privacy Policy', 'https://hanzo.ai/privacy'],
  ])
})

test('lux.id names Lux, links nothing it does not publish, and never says Hanzo', () => {
  const n = notice(brand('Lux Exchange'), org('lux', 'lux.id'))
  assert.match(n.text, /from Lux Industries at the number provided/)
  assert.doesNotMatch(n.text, /hanzo/i)
  assert.deepEqual(n.links, [], 'Lux declares no terms or privacy page')
  assert.doesNotMatch(n.text, /By continuing/, 'no sentence introducing links that are not there')
})

test('zoolabs.id links its terms and no privacy page in place of the missing one', () => {
  const n = notice(brand('Zoo'), org('zoo', 'zoolabs.id'))
  assert.match(n.text, /from Zoo Labs Foundation at the number provided/)
  assert.doesNotMatch(n.text, /hanzo/i)
  assert.deepEqual(n.links, [['Terms of Service', 'https://zoo.ngo/terms']])
  assert.match(n.text, /agree to our Terms of Service\.$/)
})

test('a brand with no company names itself, and a catalog link wins per host', () => {
  const n = notice(brand('Pars'), org('pars', 'pars.id', { privacyUrl: 'https://pars.network/privacy' }))
  assert.match(n.text, /from Pars at the number provided/)
  assert.deepEqual(n.links, [['Privacy Policy', 'https://pars.network/privacy']])
})

test('the SMS code form carries the brand notice; other channels carry none', () => {
  const lux = org('lux', 'lux.id')
  const { container, unmount } = render(<OTPForm channel="sms" brand={brand('Lux')} org={lux} onSubmit={() => {}} />)
  assert.match(container.textContent ?? '', /from Lux Industries/)
  unmount()
  const totp = render(<OTPForm channel="totp" onSubmit={() => {}} />)
  assert.equal(totp.container.querySelector('[role="note"]'), null)
})
