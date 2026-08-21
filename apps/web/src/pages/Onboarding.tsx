import { useCallback, useMemo } from 'react'
import type { BrandContract, OrgConfig } from '@hanzo/id-shared'
import { createIam, detectWalletChains, loginWithWalletChain, type AuthClient } from '@hanzo/id-auth'
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
 *   - the wallet flow the auth pkg already owns: the host holds the wallet
 *     libs so the onboarding pkg stays wallet-agnostic. No injected wallet →
 *     the wallet step is skip-only.
 *
 * On completion it lands on the portal home (`/`); a downstream app that
 * wanted a token would have carried `redirect_uri` and never reached here.
 */
export function Onboarding({ org, brand, client }: { org: OrgConfig; brand: BrandContract; client: AuthClient }) {
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

  /**
   * Bind a wallet to the person who is already signed in.
   *
   * This is the SAME `loginWithWalletChain` the sign-in buttons run — one
   * wallet path, not a second one for onboarding. Its outcome depends on the
   * live session, which IAM resolves server-side: with a session and an
   * unclaimed wallet it LINKS the wallet to that identity, which is exactly
   * what this step is for.
   *
   * The address travels back through the signer rather than the login result:
   * the login shape carries a destination, not a wallet, and the signed proof
   * is where the verified address actually lives.
   */
  const linkWallet = useCallback(async (): Promise<string | null> => {
    const [chain] = detectWalletChains()
    if (!chain) return null // no injected wallet — the step stays skip-only
    let address = ''
    const res = await loginWithWalletChain(client, chain, {}, fetch, async (c, challenge) => {
      const { loginWithWallet } = await import('@hanzo/id-connect/login')
      const { proof } = await loginWithWallet({ chain: c, challenge })
      address = proof.address
      return proof
    })
    if (res.error) throw new Error(res.error)
    return address || null
  }, [client])

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
          linkWallet={linkWallet}
          onComplete={onComplete}
        />
      </main>
    </div>
  )
}
