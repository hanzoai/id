import { useMemo } from 'react'
import type { BrandContract, OrgConfig } from '@hanzo/id-shared'
import { createIam } from '@hanzo/id-auth'
import { OnboardingFlow, createOnboardingService, type OnboardingState } from '@hanzo/id-onboarding'
import { getConnector } from '@hanzo/id-connect/connectors'
import { BrandHeader } from '../components/BrandHeader'

/**
 * Post-login onboarding page.
 *
 * Reached after a bare portal sign-in (no downstream `redirect_uri`). Mounts
 * the `@hanzo/id-onboarding` flow (org → project → wallet) wired to:
 *
 *   - the IAM session token: read from the same `@hanzo/iam` PKCE client the
 *     Callback stored it on, so the onboarding writes ride the logged-in
 *     user's bearer token. One client, one way.
 *   - a `window.ethereum` wallet connector: the host owns the wallet lib so
 *     the onboarding pkg stays wallet-agnostic. Absent injected provider →
 *     the wallet step is skip-only.
 *
 * On completion it lands on the portal home (`/`); a downstream app that
 * wanted a token would have carried `redirect_uri` and never reached here.
 */
export function Onboarding({ org, brand }: { org: OrgConfig; brand: BrandContract }) {
  const iam = useMemo(() => createIam(org), [org])

  const service = useMemo(
    () =>
      createOnboardingService({
        iamUrl: org.iamUrl,
        orgId: org.orgId,
        getAccessToken: () => iam.getValidAccessToken(),
      }),
    [org, iam],
  )

  function onComplete(_state: OnboardingState) {
    // Land on the authenticated portal (apps launcher), NOT the bare hero.
    // The marker makes the portal treat the just-established session as authed
    // even before the cross-request get-account read settles.
    window.location.replace('/?signed_in=1')
  }

  return (
    <div className="hanzo-id-page hanzo-id-onboarding-page">
      <BrandHeader brand={brand} />
      <main>
        <OnboardingFlow
          service={service}
          brandName={brand.name}
          connectWallet={connectInjectedWallet}
          onComplete={onComplete}
        />
      </main>
    </div>
  )
}

/**
 * EVM wallet connector backed by @hanzo/id-connect (EIP-6963 multi-injection,
 * viem under the hood). Returns the checksummed 0x address, or null when the
 * user cancels or no injected EVM wallet is present. The onboarding wallet step
 * only needs the address (it stores it via update-user?columns=web3onboard), so
 * we connect and return account.address — no signature round-trip here.
 */
async function connectInjectedWallet(): Promise<string | null> {
  try {
    const account = await getConnector('evm').connect()
    return account.address ?? null
  } catch {
    return null // user rejected, or no injected EVM wallet available
  }
}
