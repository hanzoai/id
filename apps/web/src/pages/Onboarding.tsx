import { useEffect, useMemo, useState } from 'react'
import type { BrandContract, OrgConfig } from '@hanzo/id-shared'
import { createIam } from '@hanzo/id-auth'
import { OnboardingFlow, createOnboardingService, type OnboardingState } from '@hanzo/id-onboarding'
import { getConnector } from '@hanzo/id-connect/connectors'
import { BrandHeader } from '../components/BrandHeader'

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
 * On completion it routes by the plan choice — the platform is prepay-only,
 * so a plan goes to the pay cart and pay-as-you-go goes to the top-up flow.
 * A downstream app that wanted a token would have carried `redirect_uri` and
 * never reached here.
 */
export function Onboarding({ org, brand }: { org: OrgConfig; brand: BrandContract }) {
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

  // null = still checking; false = run the flow; true = already done, leaving.
  const [alreadyDone, setAlreadyDone] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    service
      .readOnboarding()
      .then(({ completedAt }) => {
        if (!alive) return
        if (completedAt) {
          setAlreadyDone(true)
          window.location.replace('/?signed_in=1')
        } else {
          setAlreadyDone(false)
        }
      })
      .catch(() => {
        if (alive) setAlreadyDone(false)
      })
    return () => {
      alive = false
    }
  }, [service])

  function onComplete(state: OnboardingState) {
    // Prepay-only funnel: the last step recorded a choice, now act on it.
    //  - a plan slug  → the pay cart, seats + payment there (price is the
    //    catalog's — commerce recomputes server-side, the slug is enough)
    //  - pay as you go → the top-up flow ($5 minimum, all methods)
    // The plan choice is already persisted on the user, so bouncing off the
    // payment page never re-enters onboarding.
    const choice = state.planChoice
    if (choice === 'payg') {
      window.location.replace(`${payUrl}/onboard`)
    } else if (choice) {
      window.location.replace(`${payUrl}/cart?plan=${encodeURIComponent(choice)}`)
    } else {
      // No recorded choice (should not happen — the plan step requires one):
      // land on the authenticated portal rather than a dead end.
      window.location.replace('/?signed_in=1')
    }
  }

  return (
    <div className="hanzo-id-page hanzo-id-onboarding-page">
      <BrandHeader brand={brand} />
      <main>
        {alreadyDone === false ? (
          <OnboardingFlow
            service={service}
            brandName={brand.name}
            connectWallet={connectInjectedWallet}
            onComplete={onComplete}
            payUrl={payUrl}
          />
        ) : (
          <div className="hanzo-id-spinner" aria-label="Loading" />
        )}
      </main>
    </div>
  )
}

/**
 * EVM wallet connector backed by @hanzo/id-connect (EIP-6963 multi-injection,
 * viem under the hood). Returns the checksummed 0x address, or null when the
 * user cancels or no injected EVM wallet is present. The onboarding wallet step
 * only needs the address (it stores it via a full-row read-merge-write in the
 * service), so we connect and return account.address — no signature round-trip.
 */
async function connectInjectedWallet(): Promise<string | null> {
  try {
    const account = await getConnector('evm').connect()
    return account.address ?? null
  } catch {
    return null // user rejected, or no injected EVM wallet available
  }
}
