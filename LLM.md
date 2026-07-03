# LLM.md — Hanzo ID

## Silent SSO must be org-scoped — admin-guard god-mode fix (fixed 0.2.2 → 0.2.3)

`admin.hanzo.ai` (global-admin console) sits behind admin-guard, a Traefik
ForwardAuth that allows ONLY `owner == admin` tokens. Login rides
`client_id=hanzo-admin-guard` (org=admin). The 0.2.2 credential-form fix
(`LoginForm` posts `app.organization` from `get-app-login` → org=admin →
IAM resolves `admin/z`, owner=admin) is CORRECT and verified: posting
`organization=admin` to `/v1/iam/login` resolves the admin/* row and
`get-account` returns owner=admin.

But it "didn't take effect end-to-end" because `Login.tsx` (0.2.2) added a
`silentLogin` SSO fast-path (`canSilent = client_id && redirect_uri`) that,
on mount, minted an auth code from the AMBIENT `iam_session_id` session
REGARDLESS of that session's org. Real operators carry a hanzo/* session
(from hanzo.chat/console), so silentLogin minted an owner=hanzo code and
the guard bounced them to console.hanzo.ai — the org-scoped form was never
shown. Silent SSO shadowed the form fix.

Fix (`pkgs/auth/src/client.ts`, `silentLogin`): silent SSO may reuse the
ambient session ONLY when its user org == the app's org. `silentLogin` now
resolves the app org (`get-app-login`) + session owner (`get-account`,
new internal `sessionOwner()` helper) before minting; on no session or an
org mismatch it returns `{}` so `Login.tsx` falls back to the interactive
form (which authenticates in the app's own org). Same-org SSO (the common
case: hanzo session → hanzo app) still mints silently — no UX change.
Cross-org (hanzo session → admin-guard) → form → org=admin → owner=admin →
god-mode. Non-admins (e.g. Dave) never reach god-mode: the guard validates
`owner==admin` server-side, so this is availability (admins get IN), not a
privilege boundary — the fix is client-side and cannot admit a non-admin.
IAM (`iam:v1.31.14`) is unchanged; the SSO-ATO exact-match redirect fix
(d7648965) is untouched.

## Social login (GitHub/Google) — single-provider state + matched redirect_uri (fixed 0.1.24 → 0.1.25)

The social hop used to fail at the IAM `/callback` exchange — GitHub with
**"The provider: hanzo-iam does not exist"**, Google with "password or code is
incorrect". TWO independent bugs, both in the SPA's provider-name handling; the
IAM backend, the OAuth creds, and the registered redirect_uri were all fine.

**Bug A — wrong provider IDENTITY (fixed 0.1.24).** `parseAppLogin`
(`pkgs/auth/src/client.ts`) read the **outer** IAM app-provider LINK `name`
as the provider identity. `get-app-login` returns each provider as a link object
`{name, canSignIn, …, provider:{name, type, clientId, …}}`; the REAL identity is
the nested `provider.name` (e.g. `provider-github`), the name the backend
resolves with `GetProvider(admin/<name>)`. The outer link `name` can be a
per-app label. Fix: derive from the **nested** `rec.provider.name`, falling back
to the outer `rec.name` only when there is no nested record.

**Bug B — TWO `provider=` in the state (fixed 0.1.25).** The console→hanzo.id
SSO SDK appends `provider=hanzo-iam` (its per-org IDP hint) to the upstream
`/login/oauth/authorize` query. `social.ts::buildProviderAuthUrl` then appends
the REAL social `provider=provider-google`, so the base64 `state` carried BOTH.
`Callback.tsx` recovers the provider with `URLSearchParams.get('provider')` —
which returns the **FIRST** match (`hanzo-iam`), NOT the last — so the exchange
POSTed `provider=hanzo-iam` and the backend rejected it. (The earlier "backend
reads the LAST param" note was WRONG: the SPA reads the first.) Fix:
`buildProviderAuthUrl` strips any pre-existing `provider=` from the upstream
query (`baseQ.delete('provider')`) before appending the real one, so the state
carries **exactly ONE** `provider=`. One provider, one source of truth — no
reliance on parameter ordering. Locked in `pkgs/auth/src/social.test.ts`
("a pre-existing provider= … is stripped — state carries exactly ONE provider").

**redirect_uri consistency (hardened 0.1.25).** The hop builds the provider
`redirect_uri` from `tenant.oauthCallbackOrigin` (the provider's REGISTERED
callback host, `https://iam.hanzo.ai`, shared across brand portals).
`client.providerLogin` POSTs that redirect_uri to IAM, which forwards it
**verbatim** to the provider's token endpoint (`auth.go` →
`GetIdProvider(idpInfo, authForm.RedirectUri)` → `Config.Exchange`); a mismatch
→ `invalid_grant`. It now derives from the SAME `oauthCallbackOrigin` (was
`publicOrigin`, the brand host — equal on the callback host today, but they
diverge whenever a brand shares the iam.hanzo.ai client). Locked in
`client.test.ts` ("providerLogin posts redirectUri from oauthCallbackOrigin").

**RC#2 verified live (no Google account needed).** A junk-code probe of the live
social path — `POST iam.hanzo.ai/v1/iam/login` with `provider=provider-google` +
a fake code — returns `oauth2: "invalid_grant"`, NOT `invalid_client`. That
proves Google **accepted** the client_id + client_secret and the
`https://iam.hanzo.ai/callback` redirect_uri (client auth passed; only the fake
code was rejected). So the Google clientId/secret in the running IAM are real
and valid, the provider resolves + is enabled for `hanzo-console`, and the
redirect_uri matches — the exchange will complete with a real Google code. No
OAuth developer-console change is needed. The only thing not exercisable without
a real Google/zoo.ngo account is the final code→user round-trip itself.

## Silent single sign-on — auto-continue authorize from the issuer session (0.1.26)

Sign in ONCE at the portal; every other app that authenticates through the same
issuer host then logs in with NO form and NO credential re-entry. The IAM
backend already supported this — its `Login` handler
(`hanzoai/iam controllers/auth.go`) has an "already signed in to IAM" branch:
when the request carries the `iam_session_id` cookie but NO username/password
and NO provider, `GetSessionUsername()` is non-empty so it mints an
authorization code via `HandleLoggedIn` straight from the session. The missing
leg was the SPA: `Login.tsx` always rendered the login form, even with a live
session.

The fix wires the SPA leg. `Login.tsx` now, when an app sends the user to the
authorize page (`client_id` + `redirect_uri` on the query), first calls
`client.silentLogin(...)` — a credential-less POST to `/v1/iam/login`
(`type:code`, `application`, NO username/password, `credentials:'include'`). If a
live issuer session exists IAM returns the code and the SPA redirects straight
back to the app (`redirect_uri?code=…&state=…`); if there is no session IAM
answers `status:error` and the SPA falls back to the interactive form — never a
dead end. A bare portal visit (no `client_id`/`redirect_uri`) has nowhere to
redirect, so it shows the form immediately as before.

In Hanzo IAM the OAuth `client_id` IS the application name (`hanzo-console`,
`hanzo-chat`, …), so the SPA passes `application = client_id` with no extra
lookup. The silent leg rides the SAME `HandleLoggedIn` as password/social, so it
inherits the social-login `client_id`-resolution fix (`iam` ≥ v1.25.3) — without
it the silently-minted code would carry an empty `client_id` and fail the
downstream token exchange with `invalid_client`.

Proven end-to-end against live IAM (no UI needed): a session-cookie-only POST to
`/v1/iam/login` returns `status:ok` + a code, and that code exchanges at
`/v1/iam/oauth/access_token` (with the PKCE verifier) for a real
`access_token`+`id_token`+`refresh_token` — i.e. an existing session silently
yields a usable token for another app. Contract locked in
`pkgs/auth/src/client.test.ts` ("silentLogin posts NO credentials and redirects
with the minted code"; "returns { error } when there is no session").

Issuer-host note: SSO shares the `iam_session_id` cookie across apps only when
they funnel auth through the SAME login host. Today both console
(`IAM_SERVER_URL=iam.hanzo.ai`, which 302s to hanzo.id) and chat
(`OPENID_ISSUER=hanzo.id`) land on the hanzo.id SPA, where the cookie lives — so
the session is shared. `chat` has `OPENID_AUTO_REDIRECT=false`, so the user
clicks "Log in with Hanzo" once (provider selection, not a credential prompt);
set it `true` for fully zero-click entry into chat.

## Org-wide unified login — declare the provider set once per org (iam)

Enabling the same social/SSO set across an org's many apps is now ONE place:
the org-level `Organization.DefaultProviders` (hanzoai/iam
`object/organization.go`). Any application whose own `Providers` list is EMPTY
inherits the org's `DefaultProviders` — resolved in the single app-read path
`extendApplicationWithProviders` (`object/application.go`), so every app shares
one provider set without repeating it. An app may still pin its own `Providers`
to override. `init_data` adopts `DefaultProviders` onto an existing org
additively (`initDefinedOrganization`, `initDataNewOnly` — like languages),
never overwriting. The seed (`universe/infra/k8s/iam/init_data.json`) declares
`defaultProviders` once per org and leaves per-app `providers: []`.

**Enable unified login for a NEW org/tenant:** add the org to `init_data.json`
with `defaultProviders: [provider-github, provider-google, provider-web3,
provider-apple]` (or any subset) and leave each app's `providers: []`. All apps
inherit automatically — no per-app reconfiguration.

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
                                       same Hanzo IAM backend, tenant-scoped by org)
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
authorize request — matching the Hanzo IAM `getAuthUrl` contract. The
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

The Go IAM backend lives at `~/work/hanzo/iam` (Hanzo IAM, module
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
