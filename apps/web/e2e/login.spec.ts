/**
 * The sign-in page as a person meets it: the built export, in Chromium, on the
 * identity host it answers — hanzo.id and lux.id, one layout for both — and the
 * way from it to registration and back.
 *
 * Every request the page makes to its own host is answered here: files from
 * `dist/` (the SPA fallback included, as the edge's staticFiles does) and `/v1`
 * from an IAM double for an application that offers every way in. The brand
 * marks load from their CDN; anything else leaving the page is refused.
 */
import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type BrowserContext } from '@playwright/test'

const DIST = fileURLToPath(new URL('../dist/', import.meta.url))

const HOSTS = [
  { host: 'hanzo.id', app: 'hanzo-console', org: 'hanzo', title: 'Hanzo ID' },
  { host: 'lux.id', app: 'lux-cloud', org: 'lux', title: 'Lux ID' },
] as const

type Host = (typeof HOSTS)[number]

/** `/v1/iam/auth/application` and `/v1/iam/auth/methods` for an app offering everything. */
function iam(path: string, h: Host, enableSignUp: boolean): unknown {
  if (path === '/v1/iam/auth/methods') return { status: 'ok', data: { web3Chains: ['evm'] } }
  if (path === '/v1/iam/auth/application') {
    const provider = (key: string, type: string) => ({
      name: `provider-${key}`,
      canSignIn: true,
      provider: { name: `provider-${key}`, type, clientId: `${key}-client-id` },
    })
    return {
      status: 'ok',
      data: {
        owner: 'admin',
        name: h.app,
        organization: h.org,
        enablePassword: true,
        enableCodeSignin: true,
        enableSignUp,
        providers: [provider('github', 'GitHub'), provider('google', 'Google')],
      },
    }
  }
  return { status: 'ok', data: {} }
}

async function serve(context: BrowserContext, h: Host, enableSignUp = true) {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('no dist/ — run `pnpm --filter @hanzo/id-web build` first')
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'cdn.jsdelivr.net') return route.continue()
    if (url.hostname !== h.host) return route.abort()
    if (url.pathname.startsWith('/v1/')) return route.fulfill({ json: iam(url.pathname, h, enableSignUp) })
    const file = join(DIST, url.pathname)
    return route.fulfill({ path: extname(url.pathname) && existsSync(file) ? file : join(DIST, 'index.html') })
  })
}

/** What a person reads down the page, in document order. */
const COLUMN = [
  'h1',
  '.hanzo-id-field > span',
  '.hanzo-id-field > label',
  'button:not(.hanzo-id-revealbtn)',
  '.hanzo-id-divider',
  '.hanzo-id-footer-links a',
  '.hanzo-id-brand-footer',
].join(', ')

/** An authorize request as IAM forwards it to the sign-in page. */
const REQUEST = new URLSearchParams({
  client_id: 'hanzo-app',
  code_challenge: 'AgX39Cb83kllF6GA7XywQjfcBY8fJhLFTbT_dIbqR2c',
  code_challenge_method: 'S256',
  nonce: 'n-1',
  redirect_uri: 'https://hanzo.ai/auth/callback',
  response_type: 'code',
  scope: 'openid profile email',
  state: 'QxkkRKHhvzOvqJm0AqrdG2lhcWmnYk_sSibOcj28USw',
})

for (const h of HOSTS) {
  test(`${h.host}: email first, then "or", then every other way in, then Create a new account`, async ({ context, page }, info) => {
    await serve(context, h)
    await page.goto(`https://${h.host}/login`)
    await expect(page.locator('[data-provider="phone"]')).toBeVisible()
    await expect(page.locator('a[href^="/signup"]')).toBeVisible()
    await expect(page).toHaveTitle(h.title)

    const column = await page.locator(COLUMN).evaluateAll((nodes) =>
      nodes.map((n) => (n.matches('.hanzo-id-brand-footer') ? 'footer' : (n.textContent ?? '').trim())),
    )
    expect(column).toEqual([
      'Sign in',
      'Email or username',
      'Password',
      'Continue',
      'Send me a code instead',
      'or',
      'Continue with Google',
      'Continue with GitHub',
      'Continue with Wallet',
      'Continue with Phone',
      'Forgot password?',
      'Create a new account',
      'footer',
    ])
    await expect(page.getByText('No account?')).toBeVisible()
    await expect(page.locator('a[href^="/signup"]')).toHaveCount(1)

    // Laid out in that order too, not just written in it.
    const tops = await page
      .locator('input[autocomplete=username], .hanzo-id-divider, [data-provider=google], [data-provider=phone], .hanzo-id-brand-footer')
      .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().top))
    expect(tops).toEqual([...tops].sort((a, b) => a - b))
    // The heading sits under the corner mark's row, never beside it.
    const mark = (await page.locator('.hanzo-id-mark').boundingBox())!
    const heading = (await page.locator('main h1').boundingBox())!
    expect(heading.y).toBeGreaterThanOrEqual(mark.y + mark.height)
    // No sideways scroll at either width.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    await page.screenshot({ path: info.outputPath(`${h.host}-${page.viewportSize()!.width}.png`), fullPage: true })
  })

  test(`${h.host}: Create account opens registration with the same request, and Sign in comes back`, async ({ context, page }) => {
    await serve(context, h)
    await page.goto(`https://${h.host}/login/oauth/authorize?${REQUEST}`)
    await page.getByRole('link', { name: 'Create a new account' }).click()

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Create your .+ account$/)
    let at = new URL(page.url())
    expect(at.pathname).toBe('/signup')
    expect([...at.searchParams]).toEqual([...REQUEST])

    await page.getByRole('link', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in')
    at = new URL(page.url())
    expect(at.pathname).toBe('/login')
    expect([...at.searchParams]).toEqual([...REQUEST])
  })

  test(`${h.host}: an application that takes no new accounts offers none`, async ({ context, page }) => {
    await serve(context, h, false)
    await page.goto(`https://${h.host}/login`, { waitUntil: 'networkidle' })
    await expect(page.locator('[data-provider="phone"]')).toBeVisible()
    await expect(page.getByText('Forgot password?')).toBeVisible()
    await expect(page.getByText('No account?')).toHaveCount(0)
    await expect(page.locator('a[href^="/signup"]')).toHaveCount(0)
  })
}
