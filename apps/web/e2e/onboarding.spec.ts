import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const DIST = fileURLToPath(new URL('../dist/', import.meta.url))

const ADA = { owner: 'ada', name: 'ada', id: 'u-1', displayName: 'Ada Lovelace', email: 'ada@example.com' }

const PLANS = [
  { slug: 'pro', name: 'Pro', price: 1900, category: 'personal', popular: true, description: 'For developers & creators. Full AI model suite.' },
  { slug: 'team', name: 'Team', price: 2500, category: 'team', limits: { minSeats: 2 }, perSeat: true, description: 'For teams building together with shared workspaces.' },
]

test('onboarding opens immediately on Choose how you pay step with plan choices', async ({ context, page }) => {
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'cdn.jsdelivr.net') return route.continue()
    if (url.pathname.startsWith('/v1/iam/account')) return route.fulfill({ json: { status: 'ok', data: ADA } })
    if (url.pathname.startsWith('/v1/iam/preferences')) return route.fulfill({ json: { status: 'ok', data: {} } })
    if (url.pathname.startsWith('/v1/billing/plans')) return route.fulfill({ json: PLANS })
    if (url.pathname.startsWith('/v1/iam/auth/application')) {
      return route.fulfill({
        json: {
          status: 'ok',
          data: {
            owner: 'admin',
            name: 'hanzo-console',
            organization: 'hanzo',
            enablePassword: true,
            enableCodeSignin: true,
            enableSignUp: true,
            providers: [],
          },
        },
      })
    }
    const file = join(DIST, url.pathname)
    return route.fulfill({ path: extname(url.pathname) && existsSync(file) ? file : join(DIST, 'index.html') })
  })

  await page.goto('https://hanzo.id/onboarding')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Choose how you pay')
  await expect(page.getByText('Pick a plan, or pay as you go with a prepaid balance.')).toBeVisible()
  await expect(page.locator('.id-plan')).toHaveCount(3)
  await expect(page.locator('.id-plan').filter({ hasText: 'Pro' })).toBeVisible()
  await expect(page.locator('.id-plan').filter({ hasText: 'Team' })).toBeVisible()
  await expect(page.locator('.id-plan').filter({ hasText: 'Pay as you go' })).toBeVisible()

  // Clicking Pro saves preference and navigates to pay cart
  await page.locator('.id-plan').filter({ hasText: 'Pro' }).click()
  await page.waitForURL((url) => url.hostname === 'pay.hanzo.ai' && url.pathname.includes('/cart'))
  const payUrl = new URL(page.url())
  expect(payUrl.searchParams.get('plan')).toBe('pro')
  expect(payUrl.searchParams.get('returnUrl')).toBe('https://hanzo.id/onboarding')
})
