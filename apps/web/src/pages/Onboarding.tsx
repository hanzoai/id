import { useMemo } from 'react'
import type { BrandContract, TenantConfig } from '@hanzo/id-shared'
import { createIam } from '@hanzo/id-auth'
import { OnboardingFlow, createOnboardingService, type OnboardingState } from '@hanzo/id-onboarding'
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
export function Onboarding({ tenant, brand }: { tenant: TenantConfig; brand: BrandContract }) {
  const iam = useMemo(() => createIam(tenant), [tenant])

  const service = useMemo(
    () =>
      createOnboardingService({
        iamUrl: tenant.iamUrl,
        orgId: tenant.orgId,
        getAccessToken: () => iam.getValidAccessToken(),
      }),
    [tenant, iam],
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

/** Minimal EIP-1193 `eth_requestAccounts` connector. Null on cancel/no wallet. */
async function connectInjectedWallet(): Promise<string | null> {
  const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum
  if (!eth) return null
  try {
    const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[]
    return accounts?.[0] ?? null
  } catch {
    return null // user rejected the connection prompt
  }
}

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
}
