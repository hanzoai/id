/**
 * The cookie choice as a visitor meets it, on each identity host: nothing that
 * measures before Accept or after Reject, nothing for a browser that refuses,
 * and after Accept the brand's event stream on the brand's own key — and no
 * Google or Meta tag at all, though cloud lists both for every key here: the
 * portal reads only the consent policy from cloud's answer.
 *
 * Every request the page makes to its own host is answered from `dist/` (the
 * SPA fallback included) and `/v1/iam` from an IAM double. Every request that
 * leaves the host is recorded, and each test holds them to the set the page may
 * send at that moment: the brand mark from its CDN always, cloud's policy and
 * event ingest once the visitor accepts. A request to a measuring host is
 * answered empty, so it is counted and goes no further.
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
const brand = (host: Brand['host']) => BRANDS.find((x) => x.host === host)!

/** Google's and Meta's tags, listed beside the policy for every key; none may load. */
const TAGS = [
  { platform: 'ga4', type: 'ga', id: 'G-EKBNQ969GE' },
  { platform: 'meta', type: 'meta', id: '1790308611893001' },
]

/** A host that measures: Google, Meta, and the retired native tags. */
const MEASURES = /googletagmanager\.com|google-analytics\.com|(^|\.)facebook\.(com|net)$|analytics\.hanzo\.ai|insights\.hanzo\.ai/

/** A cookie or storage key something measuring wrote. The choice itself may stay. */
const KEPT = /^(hz_|iam-|_ga|_gid|_gat|_gcl|_gac|_fb|_tt|li_|_uet)/
const CHOICE = new Set(['hz_consent', 'hz_consent_v'])

/** One request that left the page's own host. */
interface Off {
  phase: string
  method: string
  url: URL
  referer?: string
}

interface Seen {
  /** What the test is doing now; each request is filed under it. */
  phase: string
  /** Every request that left the page's own host. */
  off: Off[]
  /** Event batches posted to /v1/event, with the key each named. */
  events: { phase: string; key: string | null; body: string }[]
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

/** What the browser refuses, and the policy cloud serves: its version, and whether it saw a refusal. */
interface Visit {
  refuses?: 'gpc' | 'dnt'
  version?: number
  refused?: boolean
}

async function serve(context: BrowserContext, b: Brand, { refuses, version = 1, refused = false }: Visit = {}): Promise<Seen> {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('no dist/ — run `pnpm --filter @hanzo/id-web build` first')
  const seen: Seen = { phase: 'load', off: [], events: [], configs: [] }
  // A person's browser, not an automated one: @hanzo/event loads no tag for a webdriver.
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }))
  if (refuses === 'gpc')
    await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true }))
  if (refuses === 'dnt') await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '1' }))

  await context.route('**/*', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const origin = `https://${b.host}`
    if (url.hostname === b.host) {
      if (url.pathname.startsWith('/v1/')) return route.fulfill({ json: iam(url.pathname, b) })
      const file = join(DIST, url.pathname)
      return route.fulfill({ path: extname(url.pathname) && existsSync(file) ? file : join(DIST, 'index.html') })
    }
    seen.off.push({ phase: seen.phase, method: req.method(), url, referer: req.headers()['referer'] })
    if (url.hostname === 'api.hanzo.ai' && url.pathname === '/v1/project/tags') {
      seen.configs.push(url)
      return route.fulfill({
        headers: CORS(origin),
        json: {
          tags: TAGS,
          consent: { region: '', mode: 'opt-in', defaults: { analytics: false, marketing: false, ads: false }, refused, version },
          audience: 'person',
        },
      })
    }
    if (url.hostname === 'api.hanzo.ai' && url.pathname === '/v1/event') {
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS(origin) })
      const bearer = req.headers()['authorization']?.replace(/^Bearer /, '') ?? null
      seen.events.push({ phase: seen.phase, key: url.searchParams.get('ingest_key') ?? bearer, body: req.postData() ?? '' })
      return route.fulfill({ headers: CORS(origin), json: { accepted: 1, dropped: 0 } })
    }
    // The brand mark, a measuring host, or anything else: recorded above, and
    // answered empty so nothing goes further.
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  })
  return seen
}

/** The brand mark the footer draws, from the brand package's CDN. */
const mark = (o: Off) => o.url.hostname === 'cdn.jsdelivr.net' && o.method === 'GET'
/** cloud's tag config and event ingest: only once the visitor allows them. */
const cloud = (o: Off) => o.url.hostname === 'api.hanzo.ai' && ['/v1/project/tags', '/v1/event'].includes(o.url.pathname)

/** Every request that left the host and is none of what the page may send now. */
function unexpected(seen: Seen, allowed: (o: Off) => boolean): string[] {
  return seen.off.filter((o) => !allowed(o)).map((o) => `${o.phase} ${o.method} ${o.url.href}`)
}

/** The page, loaded and given time for its lazy chunks and any timer to fire. */
async function open(page: Page, b: Brand, path = '/login') {
  await page.goto(`https://${b.host}${path}`)
  await expect(page.locator('.id-brand-footer')).toBeVisible()
  await page.waitForTimeout(1500)
}

/** An error the page did not catch, and a rejection nobody handled. */
async function fault(page: Page) {
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('uncaught on the identity page')
    })
    void Promise.reject(new Error('unhandled on the identity page'))
  })
  await page.waitForTimeout(1000)
}

/** Every measuring cookie and storage key this browser holds for the page. */
async function kept(context: BrowserContext, page: Page): Promise<string[]> {
  const cookies = (await context.cookies()).map((c) => c.name.replace(/^__Host-/, ''))
  const stored = await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)])
  return [...cookies, ...stored].filter((n) => KEPT.test(n) && !CHOICE.has(n))
}

interface Wire {
  type?: string
  sessionId?: string
  personId?: string
  url?: string
  referrer?: string
  properties?: Record<string, unknown>
}

/**
 * The one event @hanzo/event may send for a visitor who has not allowed
 * Analytics: an error filed under this page alone — no consent, no session or
 * person, no query on its address.
 */
function stranger(e: Wire): boolean {
  return (
    e.type === 'error' &&
    (e.properties?.consent ?? '') === '' &&
    !e.sessionId &&
    !e.personId &&
    !e.url?.includes('?') &&
    !e.referrer
  )
}

/**
 * Nothing measures: no request to a measuring host and no event. A stranger's
 * error is the most @hanzo/event would send here; this page starts no client
 * before Analytics is allowed, so it sends not even that.
 */
function nothing(seen: Seen) {
  expect(seen.off.filter((o) => MEASURES.test(o.url.hostname)).map((o) => o.url.href), 'no request to a measuring host').toEqual([])
  const sent = seen.events.flatMap((e) => (JSON.parse(e.body) as { batch: Wire[] }).batch)
  expect(sent.filter((e) => !stranger(e)), 'nothing but a stranger error').toEqual([])
  expect(seen.events, 'and no event at all').toEqual([])
}

/** A choice made on this host before, under policy 2: what the banner stores on Accept. */
async function accepted(context: BrowserContext, b: Brand) {
  const url = `https://${b.host}`
  await context.addCookies([
    { name: '__Host-hz_consent', value: 'analytics%2Cmarketing%2Cads', url, secure: true },
    { name: '__Host-hz_consent_v', value: '2', url, secure: true },
  ])
}

/** Counts the documents the tab loads, the first one included. */
function documents(page: Page): () => number {
  let n = 0
  page.on('framenavigated', (f) => void (f === page.mainFrame() && n++))
  return () => n
}

/** No Google or Meta tag: an identity host's project holds none. */
function untagged(seen: Seen) {
  expect(
    seen.off.filter((o) => /googletagmanager|google-analytics|facebook/.test(o.url.hostname)).map((o) => o.url.href),
    'no Google or Meta request from an identity host',
  ).toEqual([])
}

for (const b of BRANDS.filter((x) => x.asked)) {
  test(`${b.host}: before a choice nothing measures, not even an error, and the banner asks`, async ({ context, page }, info) => {
    const seen = await serve(context, b)
    await open(page, b)
    await expect(page.locator('[data-slot="consent"]')).toBeVisible()
    await fault(page)
    nothing(seen)
    expect(seen.configs, 'not even the tag config is asked for').toEqual([])
    expect(unexpected(seen, mark)).toEqual([])
    expect(await kept(context, page)).toEqual([])
    await page.screenshot({ path: info.outputPath(`${b.host}-asked-${page.viewportSize()!.width}.png`), fullPage: true })
  })

  test(`${b.host}: after Reject nothing measures, on this page or the next`, async ({ context, page }) => {
    const seen = await serve(context, b)
    await open(page, b)
    await page.getByRole('button', { name: 'Reject all' }).click()
    await expect(page.locator('[data-slot="consent"]')).toHaveCount(0)
    await fault(page)
    nothing(seen)
    await page.reload()
    await expect(page.locator('.id-brand-footer')).toBeVisible()
    await page.waitForTimeout(1500)
    await expect(page.locator('[data-slot="consent"]'), 'a refusal is remembered').toHaveCount(0)
    await fault(page)
    nothing(seen)
    expect(seen.configs).toEqual([])
    expect(unexpected(seen, mark)).toEqual([])
    expect(await kept(context, page)).toEqual([])
    // The footer still reopens the choices.
    await expect(page.locator('[data-slot="consent-link"]')).toBeVisible()
  })

  for (const refuses of ['gpc', 'dnt'] as const) {
    test(`${b.host}: a browser sending ${refuses.toUpperCase()} is not asked and nothing measures`, async ({ context, page }) => {
      const seen = await serve(context, b, { refuses })
      await open(page, b)
      await expect(page.locator('[data-slot="consent"]')).toHaveCount(0)
      await fault(page)
      nothing(seen)
      expect(seen.configs).toEqual([])
      expect(unexpected(seen, mark)).toEqual([])
      expect(await kept(context, page)).toEqual([])
    })
  }

  test(`${b.host}: after Accept the stream starts on the brand's own key, and no Google or Meta tag loads`, async ({ context, page }, info) => {
    const seen = await serve(context, b)
    const key = keyring()[b.org]!
    await open(page, b)
    seen.phase = 'accepted'
    await page.getByRole('button', { name: 'Accept all' }).click()
    await expect(page.locator('[data-slot="consent"]')).toHaveCount(0)

    await expect.poll(() => seen.configs.length).toBe(1)
    expect(seen.configs[0]!.searchParams.get('key')).toBe(key)
    expect(seen.configs[0]!.searchParams.get('host')).toBe(b.host)
    await expect.poll(() => seen.events.length, { timeout: 10_000 }).toBeGreaterThan(0)
    for (const e of seen.events) expect(e.key).toBe(key)
    untagged(seen)
    expect(unexpected(seen, (o) => mark(o) || (o.phase === 'accepted' && cloud(o)))).toEqual([])
    await page.screenshot({ path: info.outputPath(`${b.host}-accepted-${page.viewportSize()!.width}.png`), fullPage: true })
  })

  test(`${b.host}: Accept, then Reject from the footer, and nothing more is sent`, async ({ context, page }) => {
    const seen = await serve(context, b)
    await open(page, b)
    seen.phase = 'accepted'
    await page.getByRole('button', { name: 'Accept all' }).click()
    await expect.poll(() => seen.events.length, { timeout: 10_000 }).toBeGreaterThan(0)

    // The visitor changes their mind from "Cookie settings".
    const loaded = documents(page)
    seen.phase = 'withdrawn'
    await page.locator('[data-slot="consent-link"]').click()
    await page.getByRole('button', { name: 'Reject all' }).click()
    await expect.poll(loaded, 'the page starts over without its client').toBe(1)
    await expect(page.locator('.id-brand-footer')).toBeVisible()
    await fault(page)
    await page.waitForTimeout(8000)

    expect(seen.events.filter((e) => e.phase === 'withdrawn'), 'no /v1/event after Reject').toEqual([])
    expect(unexpected(seen, (o) => mark(o) || (o.phase === 'accepted' && cloud(o)))).toEqual([])
    expect(await kept(context, page)).toEqual([])
  })

  /**
   * A choice stored before, and cloud's policy now: a newer version, a refusal
   * cloud saw on the request, or GPC in the browser. None of them is a choice
   * the visitor made on this page, so the page loads once and stays: the form
   * renders, nothing is stored or sent, and only a newer policy asks again.
   */
  for (const [what, visit, asks] of [
    ['a newer policy', { version: 3 }, true],
    ['a refusal cloud saw', { version: 2, refused: true }, false],
    ['GPC in the browser', { refuses: 'gpc' }, false],
  ] as const) {
    test(`${b.host}: an Accept stored before, then ${what}: one load, the form, nothing sent`, async ({ context, page }) => {
      const seen = await serve(context, b, visit)
      await accepted(context, b)
      const loaded = documents(page)
      await open(page, b)
      await page.waitForTimeout(3000)
      expect(loaded(), 'the page does not reload itself').toBeLessThanOrEqual(2)
      await expect(page.locator('main h1')).toHaveText('Sign in')
      await expect(page.locator('input[autocomplete=username]')).toBeVisible()
      await expect(page.locator('[data-slot="consent"]')).toHaveCount(asks ? 1 : 0)
      await fault(page)
      nothing(seen)
      expect(await kept(context, page), 'no visitor id, session or cohort was written').toEqual([])
      expect(unexpected(seen, (o) => mark(o) || (cloud(o) && o.url.pathname === '/v1/project/tags'))).toEqual([])
    })
  }

  for (const fails of ['refused', 'replaced'] as const) {
    test(`${b.host}: the sign-in stands when the banner's chunk is ${fails}`, async ({ context, page }) => {
      const seen = await serve(context, b)
      // Refused: the network drops it. Replaced: a later deploy removed it, and
      // the SPA fallback answers its name with the page.
      await context.route(/\/assets\/banner-[^/]+\.js$/, (route) =>
        fails === 'refused' ? route.abort() : route.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' }),
      )
      await open(page, b)
      await expect(page.locator('main h1')).toHaveText('Sign in')
      await expect(page.locator('input[autocomplete=username]')).toBeVisible()
      await expect(page.locator('[data-slot="consent"]'), 'not asked, so nothing is allowed').toHaveCount(0)
      nothing(seen)
      expect(seen.configs).toEqual([])
    })
  }
}

test('lux.id is not asked, and a choice stored there loads no Google or Meta tag', async ({ context, page }) => {
  const b = brand('lux.id')
  const seen = await serve(context, b)
  await open(page, b)
  await expect(page.locator('[data-slot="consent"]')).toHaveCount(0)
  await fault(page)
  nothing(seen)
  expect(seen.configs).toEqual([])
  expect(await kept(context, page)).toEqual([])

  await accepted(context, b)
  seen.phase = 'accepted'
  await page.reload()
  await expect.poll(() => seen.configs.length).toBe(1)
  expect(seen.configs[0]!.searchParams.get('key')).toBe(keyring().lux)
  await page.waitForTimeout(1500)
  untagged(seen)
  expect(unexpected(seen, (o) => mark(o) || (o.phase === 'accepted' && cloud(o)))).toEqual([])
})

test('pars.id has no key: not asked, and even a stored Accept starts nothing', async ({ context, page }) => {
  const b = brand('pars.id')
  const seen = await serve(context, b)
  await accepted(context, b)
  await open(page, b)
  await expect(page.locator('[data-slot="consent"]')).toHaveCount(0)
  await fault(page)
  nothing(seen)
  expect(seen.configs, 'a brand with no key starts no tags').toEqual([])
  expect(unexpected(seen, mark)).toEqual([])
})

/**
 * The page's address can carry an invite, an OIDC request or an authorization
 * code. Every request it makes — to its own host as much as to any other, and
 * the next page it opens, whose scripts read `document.referrer` — is given the
 * origin and nothing after it.
 */
test('an address with a code or an invite in it never leaves the page as a referrer', async ({ context, page }) => {
  const b = brand('hanzo.id')
  await serve(context, b)
  const referers: string[] = []
  page.on('request', (r) => void r.allHeaders().then((h) => h['referer'] !== undefined && referers.push(`${h['referer']} <- ${r.url()}`)))
  await open(page, b, '/join?client_id=hanzo-app&invite=INV-SECRET-123&org=acme')
  await page.locator('.id-footer-links').getByRole('link', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in')
  expect(await page.evaluate(() => document.referrer), 'the next page reads the origin alone').toBe(`https://${b.host}/`)
  await open(page, b, '/login?client_id=hanzo-app&state=STATE-SECRET')
  await page.waitForTimeout(500)
  expect(referers.length, 'requests were made with a referrer to read').toBeGreaterThan(0)
  // The page names itself by origin; a stylesheet names itself when it fetches
  // its fonts, and its address holds nothing.
  const origin = (r: string) => r.startsWith(`https://${b.host}/ <- `)
  const sheet = (r: string) => /^https:\/\/hanzo\.id\/assets\/[^?#\s]+\.css <- /.test(r)
  expect(referers.filter((r) => !origin(r) && !sheet(r))).toEqual([])
  expect(referers.filter((r) => /SECRET/.test(r.split(' <- ')[0]!))).toEqual([])
})

test('hanzo.id: a completed sign-up is ONE moment on the stream, with its consent, and no tag hears it', async ({ context, page }) => {
  const b = brand('hanzo.id')
  const seen = await serve(context, b)
  await accepted(context, b)
  seen.phase = 'accepted'
  const request = new URLSearchParams({
    client_id: 'hanzo-app',
    redirect_uri: 'https://hanzo.ai/auth/callback',
    response_type: 'code',
    state: 'QxkkRKHhvzOvqJm0AqrdG2lhcWmnYk_sSibOcj28USw',
    code_challenge: 'AgX39Cb83kllF6GA7XywQjfcBY8fJhLFTbT_dIbqR2c',
    code_challenge_method: 'S256',
  })
  // The app the account returns to answers 204, so the browser stays on this
  // document and what it sent can be read.
  let returned = false
  await page.route('https://hanzo.ai/**', (route) => {
    returned = true
    return route.fulfill({ status: 204 })
  })
  await page.goto(`https://${b.host}/signup?${request}`)
  await expect.poll(() => seen.configs.length).toBe(1)
  await page.getByLabel('Email').fill('ada@example.com')
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple')
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect.poll(() => seen.events.some((e) => e.body.includes('"signup_completed"'))).toBe(true)
  expect(returned, 'the account goes back to the app').toBe(true)
  const done = seen.events
    .flatMap((e) => (JSON.parse(e.body) as { batch: (Wire & { event?: string })[] }).batch)
    .filter((e) => e.event === 'signup_completed')
  expect(done, 'counted once on the stream').toHaveLength(1)
  const p = done[0]!.properties!
  expect(p.consent, 'with the choice it was made under, for cloud to forward on').toBe('analytics,marketing,ads')
  expect(p.method).toBe('email')
  expect(done[0]!.url, 'the address leaves as its path').toBe(`https://${b.host}/signup`)
  untagged(seen)
  expect(unexpected(seen, (o) => mark(o) || cloud(o) || o.url.hostname === 'hanzo.ai')).toEqual([])
})
