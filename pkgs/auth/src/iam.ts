import type { OrgConfig } from '@hanzo/id-shared'
import { IAM } from '@hanzo/iam/browser'

/**
 * One IAM browser-SDK instance per org, wired to the portal's own
 * `/callback` route. This is the single place that constructs the PKCE
 * client — social/web3 sign-in (here) and the callback handler
 * (`Callback.tsx`) share it so the PKCE verifier/state the SDK stores on
 * `signinRedirect` is the same one it reads on `handleCallback`. One way.
 *
 * The portal is its own OIDC client (`clientId` = the brand `-id` app), so
 * every flow it initiates lands back at `${publicOrigin}/callback`.
 */
export function createIam(org: OrgConfig, clientId?: string): IAM {
  return new IAM({
    serverUrl: org.iamUrl,
    clientId: clientId ?? org.clientId,
    redirectUri: `${org.publicOrigin}/callback`,
    scope: 'openid profile email',
  })
}
