/**
 * The cookie choice as a visitor meets it, on each identity host: nothing that
 * measures before Accept or after Reject, nothing for a browser that refuses,
 * and after Accept only the brand's OWN tags, from the tag set its own key names.
 *
 * Every request the page makes to its own host is answered from `dist/` (the
 * SPA fallback included) and `/v1/iam` from an IAM double. cloud's tag config
 * and event ingest are answered here; every request to a measuring host is
 * recorded and answered empty, so it is counted and goes no further.
 */
import { existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const DIST = fileURLToPath(new URL('../dist/', import.meta.url))

/** The keyring the export serves: each brand is held to its own key. */
function keyring(): Record<string, string> {
  const served = JSON.parse(readFileSync(join(DIST, 'config.json'), 'utf8')) as { ingestKeyring: string }
  return JSON.parse(served.ingestKeyring) as Record<string, string>
}

const BRANDS = [
  // A brand that publishes a privacy policy is asked.
  { host: 'hanzo.id', org: 'hanzo', app: 'hanzo-console', asked: true },
  { host: 'zoolabs.id', org: 'zoo', app: 'zoo-console', asked: true },
  // Lux publishes no privacy page and Pars neither a page nor a key: not asked.
  { host: 'lux.id', org: 'lux', app: 'lux-cloud', asked: false },
  { host: 'pars.id', org: 'pars', app: 'pars-console', asked: false },
] as const

type Brand = (typeof BRANDS)[number]

/** Hanzo's GA4 property and Meta pixel: they belong on Hanzo's host and nowhere else. */
const HANZO_GA = 'G-EKBNQ969GE'
const HANZO_PIXEL = '1790308611893001'

/** cloud's answer for a project key: each brand's project holds only its own tags. */
function tagsFor(key: string | null): unknown[] {
  const keys = keyring()
  if (key === keys.hanzo)
    return [
      { platform: 'ga4', type: 'ga', id: HANZO_GA },
      { platform: 'meta', type: 'meta', id: HANZO_PIXEL },
    ]
  if (key === keys.lux) return [{ platform: 'ga4', type: 'ga', id: 'G-LUXSITE000' }]
  if (key === keys.zoo) return [{ platform: 'ga4', type: 'ga', id: 'G-ZOOSITE000' }]
  return []
}

/** A host that measures: Google, Meta, and the retired native tags. */
const MEASURES = /googletagmanager\.com|google-analytics\.com|(^|\.)facebook\.(com|net)$|analytics\.hanzo\.ai|insights\.hanzo\.ai/

/** A cookie or storage key something measuring wrote. The choice itself may stay. */
const KEPT = /^(hz_|iam-|_ga|_gid|_gat|_gcl|_gac|_fb|_tt|li_|_uet)/
const CHOICE = new Set(['hz_consent', 'hz_consent_v'])

interface Seen {
  /** Requests that left for a measuring host. */
  measuring: string[]
  /** Event batches posted to /v1/event, with the key each named. */
  events: { key: string | null; body: string }[]
  /** Tag-config requests, as URLs. */
  configs: URL[]
}

const CORS = (origin: string) => ({
  'access-control-allow-origin': origin,
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
})

/** The id IAM gives the account the sign-up creates. */
const SUBJECT = '50e43bf6-97cf-48df-8849-184a74bcb68b'

function iam(path: string, b: Brand): unknown {
  if (path === '/v1/iam/auth/methods') return { status: 'ok', data: {} }
  if (path === '/v1/iam/signup') return { status: 'ok', data: { id: SUBJECT, owner: b.org, name: 'ada' } }
  if (path === '/v1/iam/login') return { status: 'ok', data: 'c-minted' }
  if (path === '/v1/iam/account') return { status: 'error', msg: 'please sign in first' }
  if (path === '/v1/iam/auth/application')
    return { status: 'ok', data: { owner: 'admin', name: b.app, organization: b.org, enablePassword: true, enableSignUp: true, providers: [] } }
  return { status: 'ok', data: {} }
}

async function serve(context: BrowserContext, b: Brand, refuses?: 'gpc' | 'dnt'): Promise<Seen> {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('no dist/ — run `pnpm --filter @hanzo/id-web build` first')
  const seen: Seen = { measuring: [], events: [], configs: [] }
  // A person's browser, not an automated one: @hanzo/event loads no tag for a webdriver.
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }))
  if (refuses === 'gpc')
    await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true }))
  if (refuses === 'dnt') await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '1' }))

  await context.route('**/*', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const origin = `https://${b.host}`
    if (MEASURES.test(url.hostname)) {
      // Answered empty, so a tag the page starts counts as loaded and hears the
      // moments it is sent, and nothing reaches Google or Meta.
      seen.measuring.push(req.url())
      return route.fulfill({ contentType: 'application/javascript', body: '' })
    }
    if (url.hostname === 'api.hanzo.ai' && url.pathname === '/v1/project/tags') {
      seen.configs.push(url)
      return route.fulfill({
        headers: CORS(origin),
        json: {
          tags: tagsFor(url.searchParams.get('key')),
          consent: { region: '', mode: 'opt-in', defaults: { analytics: false, marketing: false, ads: false }, gpc: false, version: 1 },
          audience: 'person',
        },
      })
    }
    if (url.hostname === 'api.hanzo.ai' && url.pathname === '/v1/event') {
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS(origin) })
      const bearer = req.headers()['authorization']?.replace(/^Bearer /, '') ?? null
      seen.events.push({ key: url.searchParams.get('ingest_key') ?? bearer, body: req.postData() ?? '' })
      return route.fulfill({ headers: CORS(origin), json: { accepted: 1, dropped: 0 } })
    }
    if (url.hostname !== b.host) return route.abort()
    if (url.pathname.startsWith('/v1/')) return route.fulfill({ json: iam(url.pathname, b) })
    const file = join(DIST, url.pathname)
    return route.fulfill({ path: extname(url.pathname) && existsSync(file) ? file : join(DIST, 'index.html') })
  })
  return seen
}

/** The page, loaded and given time for its lazy chunks and any timer to fire. */
async function open(page: Page, b: Brand) {
  await page.goto(`https://${b.host}/login`)
  await expect(page.locator('.id-brand-footer')).toBeVisible()
  await page.waitForTimeout(1500)
}

/** Every measuring cookie and storage key this browser holds for the page. */
async function kept(context: BrowserContext, page: Page): Promise<string[]> {
  const cookies = (await context.cookies()).map((c) => c.name.replace(/^__Host-/, ''))
  const stored = await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)])
  return [...cookies, ...stored].filter((n) => KEPT.test(n) && !CHOICE.has(n))
}

function nothing(seen: Seen) {
  expect(seen.measuring, 'no request to a measuring host').toEqual([])
  expect(seen.events, 'no /v1/event').toEqual([])
}

/** A choice made on this host before: what the banner stores on Accept. */
async function accepted(context: BrowserContext, b: Brand) {
  const url = `https://${b.host}`
  await context.addCookies([
    { name: '__Host-hz_consent', value: 'analytics%2Cmarketing%2Cads', url, secure: true },
    { name: '__Host-hz_consent_v', value: '2', url, secure: true },
  ])
}

for (const b of BRANDS.filter((x) => x.asked)) {
  test(`${b.host}: before a choice nothing measures, and the banner asks`, async ({ context, page }, info) => {
    const seen = await serve(context, b)
    await open(page, b)
    await expect(page.locator('[data-slot="consent"]')).toBeVisible()
    nothing(seen)
    expect(seen.configs, 'not even the tag config is asked for').toEqual([])
    expect(await kept(context, page)).toEqual([])
    await page.screenshot({ path: info.outputPath(`${b.host}-asked-${page.viewportSize()!.width}.png`), fullPage: true })
  })

  test(`${b.host}: after Reject nothing measures, on this page or the next`, async ({ context, page }) => {
    const seen = await serve(context, b)
    await open(page, b)
    await page.getByRole('button', { name: 'Reject all' }).click()
    await expect(page.locator('[data-slot="consent"]')).toHaveCount(0)
    await page.waitForTimeout(1500)
    nothing(seen)
    await page.reload()
    await expect(page.locator('.id-brand-footer')).toBeVisible()
    await page.waitForTimeout(1500)
    await expect(page.locator('[data-slot="consent"]'), 'a refusal is remembered').toHaveCount(0)
    nothing(seen)
    expect(seen.configs).toEqual([])
    expect(await kept(context, page)).toEqual([])
    // The footer still reopens the choices.
    await expect(page.locator('[data-slot="consent-link"]')).toBeVisible()
  })

  for (const refuses of ['gpc', 'dnt'] as const) {
    test(`${b.host}: a browser sending ${refuses.toUpperCase()} is not asked and nothing measures`, async ({ context, page }) => {
      const seen = await serve(context, b, refuses)
      await open(page, b)
      await expect(page.locator('[data-slot="consent"]')).toHaveCount(0)
      nothing(seen)
      expect(seen.configs).toEqual([])
      expect(await kept(context, page)).toEqual([])
    })
  }

  test(`${b.host}: after Accept the brand's own tag set loads, by the brand's own key`, async ({ context, page }, info) => {
    const seen = await serve(context, b)
    const key = keyring()[b.org]!
    await open(page, b)
    await page.getByRole('button', { name: 'Accept all' }).click()
    await expect(page.locator('[data-slot="consent"]')).toHaveCount(0)

    await expect.poll(() => seen.configs.length).toBe(1)
    expect(seen.configs[0]!.searchParams.get('key')).toBe(key)
    expect(seen.configs[0]!.searchParams.get('host')).toBe(b.host)
    // The tags that set holds start, and no other brand's.
    const ga = tagsFor(key).find((t) => (t as { type: string }).type === 'ga') as { id: string }
    await expect.poll(() => seen.measuring.some((u) => u.includes(`id=${ga.id}`))).toBe(true)
    if (b.org !== 'hanzo') {
      expect(seen.measuring.some((u) => u.includes(HANZO_GA))).toBe(false)
      expect(seen.measuring.some((u) => u.includes('connect.facebook.net'))).toBe(false)
    } else {
      await expect.poll(() => seen.measuring.some((u) => u.includes('connect.facebook.net'))).toBe(true)
    }
    // And the stream starts, on the same key.
    await expect.poll(() => seen.events.length, { timeout: 10_000 }).toBeGreaterThan(0)
    for (const e of seen.events) expect(e.key).toBe(key)
    await page.screenshot({ path: info.outputPath(`${b.host}-accepted-${page.viewportSize()!.width}.png`), fullPage: true })
  })
}

test('lux.id is not asked, and with a choice stored there it loads Lux\'s tags, never Hanzo\'s', async ({ context, page }) => {
  const b = BRANDS.find((x) => x.host === 'lux.id')!
  const seen = await serve(context, b)
  await open(page, b)
  await expect(page.locator('[data-slot="consent"]')).toHaveCount(0)
  nothing(seen)
  expect(seen.configs).toEqual([])
  expect(await kept(context, page)).toEqual([])

  await accepted(context, b)
  seen.measuring.length = 0
  await page.reload()
  await expect.poll(() => seen.configs.length).toBe(1)
  expect(seen.configs[0]!.searchParams.get('key')).toBe(keyring().lux)
  await expect.poll(() => seen.measuring.some((u) => u.includes('id=G-LUXSITE000'))).toBe(true)
  await page.waitForTimeout(1500)
  expect(seen.measuring.some((u) => u.includes(HANZO_GA)), 'Hanzo GA4 never loads on lux.id').toBe(false)
  expect(seen.measuring.some((u) => u.includes('facebook')), 'Hanzo\'s pixel never loads on lux.id').toBe(false)
})

test('pars.id has no key: not asked, and even a stored Accept starts nothing', async ({ context, page }) => {
  const b = BRANDS.find((x) => x.host === 'pars.id')!
  const seen = await serve(context, b)
  await accepted(context, b)
  await open(page, b)
  await expect(page.locator('[data-slot="consent"]')).toHaveCount(0)
  nothing(seen)
  expect(seen.configs, 'a brand with no key starts no tags').toEqual([])
})

test('hanzo.id: a completed sign-up is ONE moment, on the stream and on the brand\'s tags, under one id', async ({ context, page }) => {
  const b = BRANDS.find((x) => x.host === 'hanzo.id')!
  const seen = await serve(context, b)
  await accepted(context, b)
  const request = new URLSearchParams({
    client_id: 'hanzo-app',
    redirect_uri: 'https://hanzo.ai/auth/callback',
    response_type: 'code',
    state: 'QxkkRKHhvzOvqJm0AqrdG2lhcWmnYk_sSibOcj28USw',
    code_challenge: 'AgX39Cb83kllF6GA7XywQjfcBY8fJhLFTbT_dIbqR2c',
    code_challenge_method: 'S256',
  })
  // The app the account returns to answers 204, so the browser stays on this
  // document and what it handed its tags can be read.
  await page.route('https://hanzo.ai/**', (route) => route.fulfill({ status: 204 }))
  await page.goto(`https://${b.host}/signup?${request}`)
  // The brand's tags have answered and started.
  await expect.poll(() => seen.configs.length).toBe(1)
  await expect.poll(() => seen.measuring.some((u) => u.includes(`id=${HANZO_GA}`))).toBe(true)
  await page.getByLabel('Email').fill('ada@example.com')
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple')
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect.poll(() => seen.events.some((e) => e.body.includes('"signup_completed"'))).toBe(true)
  const batch = seen.events.map((e) => JSON.parse(e.body) as { batch: { event?: string; properties?: Record<string, unknown> }[] })
  const done = batch.flatMap((x) => x.batch).filter((e) => e.event === 'signup_completed')
  expect(done, 'counted once on the stream').toHaveLength(1)
  const id = done[0]!.properties!.event_id as string
  expect(id).toBeTruthy()
  expect(done[0]!.properties!.url, 'the address leaves as its path').toBe(`https://${b.host}/signup`)

  // The same moment, under the same id, to GA4 and to Meta.
  const ga = await page.evaluate(() =>
    ((window as unknown as { dataLayer: unknown[][] }).dataLayer ?? [])
      .map((a) => Array.from(a as ArrayLike<unknown>))
      .filter((a) => a[0] === 'event'),
  )
  expect(ga.filter((a) => a[1] === 'sign_up').map((a) => (a[2] as { event_id: string }).event_id)).toEqual([id])
  const meta = await page.evaluate(() => ((window as unknown as { fbq: { queue: unknown[][] } }).fbq?.queue ?? []).map((a) => Array.from(a)))
  const registration = meta.filter((a) => a[1] === 'CompleteRegistration')
  expect(registration.map((a) => (a[3] as { eventID: string }).eventID)).toEqual([id])
})
