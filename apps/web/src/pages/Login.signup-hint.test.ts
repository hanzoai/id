import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The signup funnel has to reach signup.
 *
 * hanzo.app's "Get started" forwards `signup=true` on the authorize request and
 * this page ignored it, so a net-new customer landed on "Sign in to Hanzo ID"
 * with empty credentials and had to spot the small "Create account" link. The
 * app was already doing its part; the IdP dropped the hint.
 *
 * Source text rather than a mount: the assertions are about which BRANCH exists
 * and its ordering against silent SSO, and a render test would need the whole
 * auth client stubbed to say much less.
 */
const src = readFileSync(join(__dirname, 'Login.tsx'), 'utf8')

describe('Login honors a registration hint', () => {
  it('reads both spellings of the hint', () => {
    expect(src).toMatch(/sp\.get\('signup'\)\s*===\s*'true'/)
    // The OIDC-standard spelling, so a compliant client works without knowing ours.
    expect(src).toMatch(/sp\.get\('screen_hint'\)\s*===\s*'signup'/)
  })

  it('sends the whole OIDC request across, or registration cannot return the user', () => {
    // client_id, redirect_uri, state and the PKCE challenge live in the search
    // string; a bare '/signup' strands the new account with nowhere to go back to.
    expect(src).toMatch(/replace\(`\/signup\$\{window\.location\.search\}`\)/)
  })

  it('loses to silent SSO instead of short-circuiting it', () => {
    // Someone whose browser already holds an issuer session HAS an account.
    // The hint must sit in the fallback, so `canSilent` still wins the initial
    // phase — sending a returning customer to registration is worse than
    // ignoring the hint entirely.
    expect(src).toMatch(/const fallback = providerHint \? 'federate' : wantsSignup \? 'register' : 'form'/)
    expect(src).toMatch(/useState<[^>]*>\(\s*canSilent \? 'silent' : fallback,?\s*\)/)
  })
})
