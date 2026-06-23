# LLM.md — Hanzo ID

## Org-agnostic password login (fixed 0.1.23)

The portal login is now **org-agnostic**: it no longer pins
`organization=<brand>` on `POST /v1/iam/login`. `LoginForm` passes
`tenant.loginOrg` (a NEW, normally-UNSET `TenantConfig` field) as the
`organization`, and `client.login()` OMITS the field entirely when it is
empty/undefined. With no org posted, IAM runs its **cross-org resolution**
(`object.GetUserByFields` → `GetUserByFieldCrossOrg`) and the session encodes the
user's REAL owner-org (`GetOrganizationByUser`), never the posted hint.

Why this matters (the bug it fixes): IAM's `IsGlobalAdmin()` is
`user.Owner == "admin"` (it ignores the stored `isGlobalAdmin` column), and
`get-organizations` returns ALL orgs only for a global admin, else just the
caller's own org. The seeded superusers (`z@hanzo.ai`, `a@hanzo.ai`,
`woo@lux.network`) exist in BOTH the `admin` org (the global identity) AND their
brand org (`hanzo/lux`). Pinning `organization=hanzo` made `GetUserByFields`
hit the colliding `hanzo/z` row FIRST (in-org lookup succeeds → cross-org
fallback never runs), so an admin got a 1-org `hanzo` session via the UI even
though the API could reach the 45-org global session. Omitting the org makes the
in-org lookups miss → cross-org fallback → `admin/z` (global) for the colliding
hanzo-domain emails, while a brand-only identity (`z@lux.network`,
`major@hanzo.ai`, …) still resolves to its own org. Verified live on
`hanzo.id`: `z@hanzo.ai` → `owner=admin`, 45 orgs; a brand-only user → 1 org.

Boundaries (do NOT regress):
- **Signup** still sends a concrete `organization` (`tenant.orgId`) — you cannot
  create a user in "no org". Only LOGIN omits it.
- **Per-app SSO** (console/chat/team pass their own `client_id` + `redirect_uri`)
  is unaffected: `type=code` + the app's client_id still flow; the auth code is
  bound to the cross-org-resolved user. Proven against live IAM with
  `application=hanzo-console`.
- A brand that deliberately wants single-org portal login can set `loginOrg` in
  its runtime catalog entry (`id-tenant-catalog` ConfigMap) — no rebuild.
- Contract locked in `pkgs/auth/src/client.test.ts` (omit-when-unset,
  omit-when-empty, include-when-set, SSO still omits, signup still sends).

## PKCE on password login (fixed 0.1.13)

`client.login()` (POST `/v1/iam/login`) must forward `code_challenge`
/`code_challenge_method` on the QUERY string, exactly like `authorize()`.
IAM's Login handler (`hanzoai/iam` `controllers/account.go`) reads
`code_challenge` from the query first, body fallback, then threads it into
`GetOAuthCode` so the minted code stores the challenge. Omitting it makes
IAM store an EMPTY challenge; the downstream public SPA client (e.g.
`hanzo-platform`) then fails token exchange with
`token.CodeChallenge: empty` → `invalid_client` (it falls back to a
client_secret check the public client can't satisfy — see
`object/token_oauth.go:809-844`: with a non-empty stored challenge AND no
client_secret sent, the secret check is bypassed). Social login was never
affected (it rides `authorize()`). Plumb the URL's `code_challenge`
through Login page → LoginForm → `client.login()`; do NOT default a
challenge — only forward what the downstream OAuth request put on the URL.

Known SEPARATE blocker (NOT this repo): after a 200 token exchange,
platform's `/v1/iam/session` (`hanzo/platform` `pkg/platform/src/lib/iam.ts`
→ `@hanzo/iam/server` `getServerSession`) returns 401 "Invalid IAM token"
for a valid `aud:[hanzo-platform]` RS256 JWT signed by `cert-hanzo` (key IS
in hanzo.id JWKS; the duplicate `cert-hanzo` entry is identical, harmless).
That is a platform/SDK-side verification bug, tracked separately.

## What this is

White-label login + identity verification portal. Vite SPA, served from
the Hanzo K8s cluster, white-labels per hostname.

Replaces:
- `~/work/hanzo/hanzo.id-worker` (Cloudflare Worker) — being decommissioned
- `~/work/hanzo/id/legacy-nextjs/` (Next.js 15) — frozen, kept for diff

## Architecture

```
DNS                   →  hanzo cluster ingress (129.212.164.5)
hanzo.id  ──┐
lux.id    ──┤  ─ TLS  →  ingress  ─ K8s ─→  Service id  ─→  Deployment id (2 replicas)
zoo.id    ──┤             (Traefik)                         ghcr.io/hanzoai/id:vX.Y.Z
pars.id   ──┘                                                    │
                                                                 │ on boot:
                                                                 │   resolveTenant(hostname)
                                                                 │   loadBrand(tenant.brandPackage)
                                                                 ▼
                                                            @hanzo|luxfi|zooai|parsdao /brand
                                                                 │
                                                                 ▼
                                                            createAuthClient(tenant)
                                                                 │
                                                                 ▼
                                       per-brand OIDC issuer host: hanzo.id / lux.id /
                                       zoo.id / pars.id  (serves /.well-known + /v1/iam/*;
                                       same Casdoor-fork backend, tenant-scoped by org)
                                                                 │
                                                                 ▼
                                                  iam-* postgres in hanzo namespace
```

`iamUrl` is the brand's OWN `*.id` host, NOT `iam.hanzo.ai` (HIP-0111:
discovery must be host-relative or the SDK resolves to the IAM SPA HTML
catch-all). One backend serves every brand behind its issuer host.

## Auth methods — the full set

Email/password + email/SMS code + GitHub + Google + Web3 (wallet). The enabled
set is read LIVE from `/v1/iam/get-app-login` (`AuthClient.getAppLogin`), which
mirrors each `-id` app's provider config in
`universe/infra/k8s/iam/init_data.json`. Password sign-in goes through the IAM
REST `login` and returns an auth code directly. Both honor a downstream
`redirect_uri`.

### Social providers — render only when configured; redirect via the "hop"

`SocialButtons` renders ONLY providers IAM holds a REAL credential for
(`AppProvider.configured` = non-placeholder clientId). With the seed's
placeholders every social button is hidden, so a user never hits a dead-end;
they reappear automatically once real creds land. Clicking a configured OAuth
provider runs the **hop** (`social.ts::startProviderLogin`), which redirects
straight to the provider with a base64 `state` that round-trips the original
authorize request — matching the IAM (Casdoor) `getAuthUrl` contract. The
provider returns to `/callback`; `Callback.tsx` detects the provider state and
calls `client.providerLogin` to exchange the code at the IAM backend, then
follows the continue-URL (which re-enters `/callback` as the normal OIDC code).
(NOT `@hanzo/iam` `signinRedirect` — that loops back to the login page.)

**To ENABLE real social login (the only remaining work):**
1. Register an OAuth app per provider (GitHub/Google) with callback
   **`https://<brand>/v1/iam/callback`** AND the app authorize redirect
   `https://<brand>/callback` (per brand host: hanzo.id, lux.id, pars.id …).
2. Put the client id/secret in KMS at **project `hanzo-iam`, env `prod`**, keys
   `IAM_GITHUB_CLIENT_ID` / `IAM_GITHUB_CLIENT_SECRET` (and `IAM_GOOGLE_*`). The
   `iam-kms-sync` KMSSecret (`universe/infra/k8s/iam/secret.yaml`) syncs that
   path into `iam-secrets`; init_data.json substitutes `${IAM_GITHUB_CLIENT_ID}`
   at deploy. The whole sync + env-ref chain already exists — today those keys
   just hold placeholder values, so providers read as unconfigured (buttons
   hidden). Replace the values; nothing else to wire.
3. The buttons appear automatically (no portal change). **Live-verify** the
   round-trip reaches the provider and completes — the hop + exchange are wired
   and unit-tested (`pkgs/auth/src/social.test.ts`) but can only be exercised
   end-to-end once real creds exist.

## Workspace

```
apps/
  web/          @hanzo/id-web  — Vite + React 19 + @hanzo/gui SPA
pkgs/
  shared/       @hanzo/id-shared — TenantConfig, resolveTenant, loadBrand
  auth/         @hanzo/id-auth   — composable login/signup/OTP/forgot forms +
                                   SocialButtons (GitHub/Google/Web3) +
                                   AuthClient (wraps @hanzo/iam REST + SDK PKCE)
  onboarding/   @hanzo/id-onboarding — post-login org → project → wallet flow.
                                   domain (serializable step machine) / service
                                   (IAM-backed writes) / ui (self-contained flow).
                                   Tests: `pnpm --filter @hanzo/id-onboarding test`
                                   (Node built-in runner, no test-framework dep).
  idv/          @hanzo/id-idv    — pluggable identity verification
                                   (Persona, Onfido, Veriff, stub)
legacy-nextjs/  Frozen predecessor. Delete after v0.1.0 ships.
```

## Why this layout (and not just Next.js)

1. **Vite > Next.js for an SPA.** No SSR needed; auth is post-load only.
   ~200kb gzip vs ~600kb. Build is 3s vs 90s.
2. **@hanzo/gui v7 is the canonical UI.** Same shell as every other
   Hanzo admin surface. No bespoke components.
3. **Per-org brand packages.** `@hanzo/brand`, `@luxfi/brand`,
   `@zooai/brand`, `@parsdao/brand` already ship `brand.json` files;
   we fetch them at runtime. Adding a brand = `pnpm add @newco/brand`
   + one line in `pkgs/shared/src/tenant.ts` (or a runtime catalog
   entry — no rebuild).
4. **Provider-pluggable IDV.** Same surface for Persona, Onfido, Veriff,
   custom backends. No vendor lock-in at the portal layer.
5. **Mirrors downstream tenant id-app forks.** Same `apps/` + `pkgs/`
   pattern, same `@hanzo/gui` shell, same per-tenant brand resolution.

## Local dev

```bash
pnpm install
pnpm dev      # http://localhost:5173 → defaults to hanzo brand
```

For multi-tenant preview:
```
echo "127.0.0.1 lux.id zoo.id pars.id" | sudo tee -a /etc/hosts
```
then visit `http://lux.id:5173` etc.

## Build + deploy

```bash
pnpm build
# Deploy is managed in hanzoai/universe (infra/k8s/id/): operator/kustomize
# applies it; CI image bump flows via universe. App repo ships the
# brand-neutral image + Dockerfile only — no deploy/brand config here.
```

## Adding a new brand

1. `pnpm add -F @hanzo/id-web @newco/brand`
2. Add `TenantConfig` for the hostname in `pkgs/shared/src/tenant.ts`
   (or put it in `IAM_TENANT_CONFIG_JSON` at runtime — no rebuild).
3. Add the hostname to `BRAND_PACKAGES` in `apps/web/vite.config.ts`.
4. Add host + TLS secret to `apps/web/k8s/ingress.yaml`.
5. DNS → cluster ingress IP.

## Plugging an IDV provider

```ts
import { registerProvider, createPersonaProvider } from '@hanzo/id-idv'
registerProvider(createPersonaProvider({ templateId, apiKey, environment: 'production' }))
```

## Pre-built providers

| id | source | docs |
|---|---|---|
| `stub` | `@hanzo/id-idv/providers/stub` | in-memory, dev-only |
| `persona` | `@hanzo/id-idv/providers/persona` | https://docs.withpersona.com |
| `onfido` | `@hanzo/id-idv/providers/onfido` | https://documentation.onfido.com |
| `veriff` | `@hanzo/id-idv/providers/veriff` | https://developers.veriff.com |

Custom providers: implement the `IDVProvider` interface in
`pkgs/idv/src/provider.ts` and register it.

## Cutover from the CF Worker

1. Build + push image (PR scaffolds; image bump comes after CI green).
2. `kubectl apply -k apps/web/k8s` — Deployment + Service + Ingress live.
3. cert-manager issues TLS for all 4 hosts.
4. Remove the Cloudflare Worker routes for the 4 identity hosts.
5. Repoint CF A records: `hanzo.id`, `lux.id`, `zoo.id`, `pars.id` →
   `129.212.164.5` (hanzo cluster ingress LB), CF-proxied.
6. Verify each host loads its own brand.
7. Archive `hanzo.id-worker` repo.

## Backend

The Go IAM backend lives at `~/work/hanzo/iam` (Casdoor fork, module
`github.com/hanzoai/iam`, image `ghcr.io/hanzoai/iam`). All paths are under
the `/v1/iam` prefix — no legacy `/oauth/*`, no `/api/`. This portal talks
to it via:

- auth (`pkgs/auth/src/client.ts`): `/v1/iam/login` `/v1/iam/signup`
  `/v1/iam/send-verification-code` `/v1/iam/get-app-login`, and the OIDC
  PKCE endpoints `/v1/iam/oauth/{authorize,token,userinfo,logout}` (via the
  `@hanzo/iam` SDK).
- onboarding (`pkgs/onboarding/src/service/onboarding.ts`):
  `/v1/iam/get-organizations` (allowed for any signed-in user, scoped to
  their memberships server-side), `/v1/iam/add-organization` +
  `/v1/iam/add-project` (admin-gated in IAM authz — the create path surfaces
  a permission message for non-admins and stays skippable),
  `/v1/iam/get-account` + `/v1/iam/update-user?columns=web3onboard` (wallet
  link).

All hostnames talk to the same IAM backend — the org is carried in the
request body (`organization: <orgId>`), and the IAM backend tenant-scopes
on that.
