import { useEffect, useMemo, useState } from 'react'
import type { Brand, Org } from '@hanzo/id-shared'
import { createIam, loginWithWalletChain, type AuthClient } from '@hanzo/id-auth'
import {
  OnboardingFlow,
  createOnboardingService,
  resume,
  type OnboardingState,
  type StepId,
} from '@hanzo/id-onboarding'
import { BrandFooter } from '../components/BrandFooter'

/** Fleet default pay origin; a white-label brand overrides via catalog `payUrl`. */
const DEFAULT_PAY_URL = 'https://pay.hanzo.ai'

/**
 * Post-login onboarding page.
 *
 * Reached after a bare portal sign-in (no downstream `redirect_uri`). Mounts
 * the `@hanzo/id-onboarding` flow (org → project → wallet → consent → plan)
 * wired to:
 *
 *   - the IAM session token: read from the same `@hanzo/iam` PKCE client the
 *     Callback stored it on, so the onboarding writes ride the logged-in
 *     user's bearer token. One client, one way.
 *   - a `window.ethereum` wallet connector: the host owns the wallet lib so
 *     the onboarding pkg stays wallet-agnostic. Absent injected provider →
 *     the wallet step is skip-only.
 *
 * NEVER REPEATS: completion is recorded on the USER (Properties, via
 * saveOnboarding) — so before mounting the flow this page reads it back and,
 * if the user already finished onboarding on ANY browser, goes straight to
 * the portal. The read failing open (network blip → run the flow again) is
 * deliberate: repeating is annoying, silently skipping a required step is
 * worse.
 *
 * NEVER RESTARTS EITHER: the same read says where to RESUME. Every answer the
 * account already holds retires its step, so a refresh, a closed tab, a second
 * sign-in — or an account provisioned somewhere else entirely, which has an org
 * but none of this flow's keys — lands on what is genuinely outstanding. It used
 * to reopen at step 1 and dead-end there, because IAM gives an account one org
 * and answers a request for a second with a conflict the screen showed as a name
 * clash.
 *
 * On completion it routes by the plan choice — the platform is prepay-only,
 * so a plan goes to the pay cart and pay-as-you-go goes to the top-up flow.
 * A downstream app that wanted a token would have carried `redirect_uri` and
 * never reached here.
 */
export function Onboarding({
  client,
  org,
  brand,
}: {
  client: AuthClient
  org: Org
  brand: Brand
}) {
  const iam = useMemo(() => createIam(org), [org])
  const payUrl = org.payUrl || DEFAULT_PAY_URL

  const service = useMemo(
    () =>
      createOnboardingService({
        iamUrl: org.iamUrl,
        orgId: org.orgId,
        getAccessToken: () => iam.getValidAccessToken(),
      }),
    [org, iam],
  )

  // null = still checking; a value = run the flow from there; 'done' = leaving.
  const [entry, setEntry] = useState<'done' | { answered: StepId[]; data: OnboardingState } | null>(null)
  useEffect(() => {
    let alive = true
    ;(async () => {
      // TOKEN BOOTSTRAP. A password/form sign-in mints a SESSION COOKIE and
      // lands here directly — the PKCE SDK holds no token, so every onboarding
      // WRITE (update-user needs a bearer; the cookie alone is refused, and
      // rightly — a cookie-authed write is a CSRF surface) answered 401 and
      // the funnel dead-ended at consent. With a live session, authorize is
      // the silent-SSO branch: signinRedirect bounces through IAM with no UI,
      // /callback stores the token and returns to /onboarding. One bounce per
      // session, guarded, so a broken mint degrades to the read-only 401
      // instead of a redirect loop.
      const token = await iam.getValidAccessToken().catch(() => null)
      if (!alive) return
      if (!token) {
        const guard = 'onboarding.token_bounce'
        if (!sessionStorage.getItem(guard)) {
          sessionStorage.setItem(guard, '1')
          void iam.signinRedirect()
          return
        }
      } else {
        sessionStorage.removeItem('onboarding.token_bounce')
      }
      try {
        const answers = await service.readOnboarding()
        if (!alive) return
        if (answers.completedAt) {
          setEntry('done')
          window.location.replace('/?signed_in=1')
          return
        }
        // Not finished — so open on whatever the account leaves outstanding.
        setEntry(resume(answers))
        return
      } catch {
        // Read failing open (network blip → run the whole flow) is deliberate.
      }
      if (alive) setEntry({ answered: [], data: {} })
    })()
    return () => {
      alive = false
    }
  }, [service, iam])

  function onComplete(state: OnboardingState) {
    // Prepay-only funnel: the last step recorded a choice, now act on it.
    //  - a plan slug  → the pay cart, seats + payment there (price is the
    //    catalog's — commerce recomputes server-side, the slug is enough)
    //  - pay as you go → the top-up flow ($5 minimum, all methods)
    // The plan choice is already persisted on the user, so bouncing off the
    // payment page never re-enters onboarding.
    const choice = state.planChoice
    // Carry where to come BACK to. Checkout is a different origin, and with no
    // returnUrl it has nothing to name: its header logo and Cancel link stood in the
    // first entry of the org's return allowlist, which is a security list in
    // arbitrary order — so a customer who had just finished onboarding here was
    // offered an exit into whichever product sorted first. pay validates this against
    // that same allowlist and ignores anything not on it, so sending it can only
    // narrow where a buyer lands, never widen it.
    const back = encodeURIComponent(`${window.location.origin}/?signed_in=1`)
    if (choice === 'payg') {
      window.location.replace(`${payUrl}/onboard?returnUrl=${back}`)
    } else if (choice) {
      window.location.replace(`${payUrl}/cart?plan=${encodeURIComponent(choice)}&returnUrl=${back}`)
    } else {
      // No recorded choice (should not happen — the plan step requires one):
      // land on the authenticated portal rather than a dead end.
      window.location.replace('/?signed_in=1')
    }
  }

  return (
    <div className="hanzo-id-page hanzo-id-onboarding-page">
      <main>
        {entry && entry !== 'done' ? (
          <OnboardingFlow
            service={service}
            brandName={brand.name}
            initial={entry}
            bindWallet={() => bindWallet(client)}
            onComplete={onComplete}
            payUrl={payUrl}
          />
        ) : (
          <div className="hanzo-id-spinner" aria-label="Loading" />
        )}
      </main>
      <BrandFooter brand={brand} org={org} />
    </div>
  )
}

/**
 * Bind an EVM wallet to the signed-in account, and answer with the address IAM
 * recorded (null when the person cancels or no injected wallet is present).
 *
 * This is the SAME call wallet sign-in makes — `loginWithWalletChain` mints the
 * CAIP-122 challenge, has the wallet sign it, and posts the proof to
 * /v1/iam/web3/verify. With a live same-site session IAM attaches the wallet to
 * that identity instead of signing anyone in, so one client covers both and the
 * binding is a signed proof rather than a typed-in string. `redirectUrl` is
 * ignored here on purpose: we are already on the page it names.
 *
 * The step used to connect without signing and post the address into a
 * `web3onboard` user field, which IAM's schema does not have — the write was
 * dropped, the summary showed the address anyway, and nothing was bound.
 */
async function bindWallet(client: AuthClient): Promise<string | null> {
  const res = await loginWithWalletChain(client, 'evm')
  if (res.error) throw new Error(res.error)
  return res.walletAddress ?? null
}
