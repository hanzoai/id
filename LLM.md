# LLM.md — Hanzo ID

## Google login was dead on every surface: a renamed wire key, and a default that could only be wrong (0.2.20)

"Continue with Google" failed on hanzo.id/signup, console.hanzo.ai and hanzo.app
with `Error 400: redirect_uri_mismatch`. Measured cause, one line:

    -  const cfg = (await res.json()) as { iamTenantConfigJson?: string }   // 0.2.16
    +  const cfg = (await res.json()) as { iamOrgConfigJson?: string }      // 0.2.17+ (bd04657)

`bd04657` ("orgs, not tenants") renamed `TenantConfig`→`OrgConfig` across 28
files and carried the rename into a name that is **not ours**: the key on the
`/config.json` document. `id-tenant-catalog` ships `SPA_IAM_TENANT_CONFIG_JSON`,
hanzoai/spa camelCases each `SPA_*` var, so the served key is and remains
`iamTenantConfigJson`. Live, on the 0.2.19 bundle:

    GET https://hanzo.id/config.json  → 200 {"iamTenantConfigJson":"{…}"}
    bundle index-dVaC2oik.js          → (await b.json()).iamOrgConfigJson

The fetch kept returning 200 and the read kept returning `undefined`, so
`parseCatalog({})` → the built-in `DEFAULT_TENANTS['hanzo.id']` won on every
host. Both reported symptoms fall straight out of that one substitution:

- `application=hanzo-id` in the OAuth state — the built-in `appName`, where the
  catalog says `hanzo-console`. Nothing was ever "derived from the hostname".
- `redirect_uri=https://hanzo.id/callback` — the built-ins carry no
  `oauthCallbackOrigin`, and `normalize()` **invented one from `publicOrigin`**.
  Google's client (`113591532635-…`) accepts exactly one value,
  `https://iam.hanzo.ai/callback`. GitHub hid it by accepting anything.

The rename is the trigger. The DEFAULT is the bug — a config gap could only ever
become a broken Google URL, produced silently, discovered at the provider, after
the user clicked. So:

- **`oauthCallbackOrigin` has NO default** (`org.ts::normalize`). Unset means
  "social is not configured for this host", which is TRUE, and is checkable here
  rather than at accounts.google.com. `publicOrigin` was never a fallback: no
  brand host is a registered redirect URI except by accident.
- **`buildProviderAuthUrl(p, callbackOrigin, search)` no longer takes a browser
  origin at all** — the parameter existed only to be the wrong default. Empty
  origin THROWS. (`null` stays what it was: a provider we don't render.)
- **`SocialButtons` hides OAuth entries with no callback origin**, the same rule
  it already applies to providers IAM holds no credential for. A missing catalog
  now costs social sign-in, not every sign-in — password/email still render.
- **`client.providerLogin` refuses** instead of posting `publicOrigin`; that leg
  feeds IAM → Google's token endpoint, where the same invented value returns
  `invalid_grant` one step further along.
- **`catalogJsonFrom` is the ONE place the served key name appears**, with the
  ConfigMap named in its doc comment, pinned by a test against the live
  document. That is the seam the rename lacked.

161 tests green, typecheck clean. Verified by reintroducing each defect
separately: the `publicOrigin` default fails "oauthCallbackOrigin comes from the
catalog and is NEVER defaulted to this host" (→ *hanzo.id invented an OAuth
callback origin*) and the no-catalog P0 test; the renamed key fails
"catalogJsonFrom reads the key the RUNTIME serves"; a silent origin substitution
fails both "an empty callbackOrigin THROWS" and the P0 test. `social.test.ts`'s
"No callbackOrigin → defaults to the browser origin" assertion, which pinned the
defect as the contract, is gone.

**GitHub `main` was 8 commits STALE and production was AHEAD of it.** Canonical
is git.hanzo.ai (`1ac8c59`, 0.2.19 — the running image); `github.com/hanzoai/id`
main sat at `1e91944`, 0.2.16. Anything cut from the GitHub mirror would have
reverted 0.2.17–0.2.19. This work is based on the forge tip. `ghcr.io/hanzoai/id`
already holds 0.2.16–0.2.19, and the build refuses to rebuild an existing
version, so the next free patch is **0.2.20**.

## The whole token layer, the ONE account control, and a gate on resolution (0.2.15)

0.2.14 adopted @hanzo/design and, in three places, worked around it. Those
findings have been fixed IN @hanzo/design 0.3.0, so the workarounds are gone and
this surface takes the system's answer.

- **ONE import: `@hanzo/design/styles.css`.** `app.css` cherry-picked four of the
  nine token groups, so `--z-*`, `--shadow-*`, `--space-*`, `--font-*` and the
  element defaults did not exist here at all. Nothing broke visibly, because an
  unresolved `var()` paints nothing and reports no error — that silence is the
  whole defect. @hanzo/iam's account menu alone reaches for `--z-popover`,
  `--shadow-floating` and `--space-1..3`.
- **Geist is SELF-HOSTED in @hanzo/design 0.3.0**, so the reason for
  cherry-picking is gone: `tokens/fonts.css` no longer requests
  fonts.googleapis.com and the sign-in path can take the typeface with the
  colours. Measured on the built bundle: rendered face is Geist, served from
  `/assets/Geist-Variable-*.woff2`, zero third-party font requests.
- **The focus rule is DELETED from this file.** `tokens/base.css` ships
  `:focus-visible{outline:2px solid var(--ring)}` to every consumer, and 0.3.0
  moved `--ring` to `var(--neutral-500)`. Measured in browser: `2px solid
  rgb(115,115,115)`, **4.43:1** on `--background` (WCAG 2.4.11 wants 3:1). The
  local `--primary` override existed only because `--ring` was 1.66:1.
- **Control boundaries are `--border-strong`, not `--white-40`.** 0.3.0 moved
  `--border-strong` to `var(--neutral-500)` — 4.43:1, in BOTH themes. `--white-40`
  cleared 3:1 on black and measures 1.00:1 on white, so it would have vanished
  the moment a light theme arrived.
- **The signed-in portal mounts `<UserMenu>` from @hanzo/iam** (bumped
  0.13.1 → 0.21.1 in `apps/web`, `pkgs/auth`, `pkgs/onboarding`) in place of a
  hand-rolled "Billing / Sign out" link row. Identity comes from
  `resolveIdentity`, the same resolution every Hanzo surface shows, so the portal
  cannot disagree with the console about who you are. No `brand` prop is passed:
  omitting `markSvg` would put the HANZO mark on lux.id and zoo.id.
- **Portal.tsx's inline `style={{…}}` is gone.** It carried
  `rgba(255,255,255,0.14)`, `borderRadius 12`, `fontSize 13`, `fontWeight 600`
  and two bare opacities — six invented values for facts the token layer already
  states. `.hanzo-id-apps` / `.hanzo-id-applink` now, class-keyed like the rest.
- **`apps/web/src/tokens.test.ts` is the gate, and it tests RESOLUTION.**
  "It is declared" was never evidence, and neither was "it type-checks": the
  reference is built at runtime from a string, so it is invisible to the compiler
  AND to grep. The test walks `app.css`'s `@import` graph into the installed
  @hanzo/design, then asserts (1) every token group is served, (2) every
  `var(--x)` under `src/` resolves, (3) every token @hanzo/iam's bundle paints
  the menu with resolves. Verified by reintroducing both original defects: it
  names the 5 dropped groups and the 8 unresolved iam tokens. `vitest.config.ts`
  now includes `apps/**` so it actually runs.

Measured in Chromium, fresh context, empty storage, 1440 AND 390, against the
built bundle served as hanzo.id / lux.id / zoolabs.id: **0 unresolved tokens of
76 referenced** on every host; input edge and focus ring both 4.43:1; the account
menu paints `#0a0a0a` fill / 12px radius / `--shadow-floating` / `z-index 700`
(it was transparent before the iam fix). Brand switches with zero per-brand code:
hanzo.id → "Hanzo ID" + Hanzo apps, lux.id → "Lux ID" + Lux apps, and no Hanzo
mark reaches the Lux menu.

STILL OPEN, and they are findings against layers below this surface, not against
this repo: the menu's own panel edge is `--border` at 1.27:1 on `--popover` —
0.3.0 raised `--ring` and `--border-strong` but not `--border`, so a floating
panel still has no perceivable edge. And `BrandHeader` loads the brand mark from
`cdn.jsdelivr.net/npm/@<brand>/brand@latest/...` — a third-party request pinned
to `@latest` on the sign-in path, which is exactly what this file refuses for
fonts.

## One token layer, and no control painted by its ancestor (0.2.14)

The portal is now styled from **@hanzo/design tokens** — the same token layer
hanzoai/pay renders from, so the two halves of one flow (sign in → pay) agree on
the page black, the type ramp, the radii and the greys. `apps/web/src/app.css`
invents no colour, radius or size; `@hanzo/gui` was declared as a dependency but
never imported once, and is removed rather than left as decoration.

- **Surface is keyed to a CLASS the component carries, never to where it is
  mounted.** The stylesheet used to paint controls with the descendant selectors
  `form input {…}` and `.hanzo-id-btn, form button {…}`. `DeviceApproval.tsx` —
  the screen a human hits to authorise the CLI — has 2 inputs and **0** `<form>`
  ancestors, so its device-code field fell out of the stylesheet and rendered as
  raw UA chrome: 31px tall, `#3b3b3b`, `2px inset` bevel, square corners, beside
  correctly-styled 44px siblings. Every control now carries `.hanzo-id-input`,
  `.hanzo-id-btn`, `.hanzo-id-field` or `.hanzo-id-form`, and there is not one
  element-descendant selector for surface left in the file. Same class of defect
  as a component library shipping utility class names with no CSS behind them —
  the mirror image, bare elements instead of bare class names.
- **`.hanzo-id-spinner` had no rule at all.** The loading state measured 0px and
  was invisible on hanzo.id, lux.id and pars.id at once. It is a real 28px ring
  now, verified rendering and animating.
- **ONE focus indicator.** The file had exactly one focus rule (`form
  input:focus`), so every button, link and social entry fell back to Chrome's
  `outline: auto` — a blue ring on a monochrome surface. `:focus-visible` is now
  global, 2px `--primary`. Note `--ring` (#333333) measures **1.66:1** on
  `--background` and cannot carry a focus indicator; that is a finding against
  @hanzo/design, not a licence to invent a value.
- **ONE button.** `.hanzo-id-social-btn` and the `.primary` modifier are gone:
  `.hanzo-id-btn` IS primary, `.ghost` is the secondary surface (social sign-in,
  Skip/Back). 13 treatments → 1 primitive with 1 modifier.
- **`font: inherit` on every control.** Buttons and inputs rendered in Arial
  while headings rendered in the platform face — two typefaces in one 432px card,
  including on the "Sign in" CTA.
- **Control borders are `--white-40`, deliberately.** On `--background` the
  semantic `--border` (#1f1f1f) measures 1.27:1 and `--border-strong` (#404040)
  2.03:1 — neither clears the 3:1 a control boundary needs (WCAG 1.4.11).
  `--white-40` measures 3.66:1 and is on the ladder.
- **Fonts are NOT imported from the design package.** `tokens/fonts.css` pulls
  Geist from fonts.googleapis.com; the sign-in path loads no third-party font.
  `--font-sans` resolves to the platform stack, the identical value hanzoai/pay
  sets. Self-hosting Geist would let both import `fonts.css` unchanged.

Measured in a real browser against the built bundle (fresh context, empty
storage): page `#000000`, controls 44px, one 6px radius, h1 21px, white focus
ring, no control under the touch floor at 390px, no horizontal overflow.

**This release also reunites `main` with production.** The running image (0.2.13,
built from `9477777`) was NOT on `origin/main`: the two had diverged at
`7a72225f`, with the self-service-signup fix (`/v1/iam/onboard` instead of the
admin-only `add-organization` verb) and the App/Chat/Cloud launcher live but
unmerged. A release cut from `main` would have silently regressed both. 0.2.14 is
the merge, so `main` is once again what runs.

## One chain-agnostic "Connect Wallet" button — merge EVM + Solana entries (0.2.9)

The login page rendered ONE wallet button PER enabled chain (`SocialButtons`
mapped `ENABLED_WALLET_CHAINS` → "Continue with Ethereum / EVM" +
"Continue with Solana"), so a two-chain build showed two near-identical buttons
above the divider. Merged into a SINGLE chain-agnostic "Connect Wallet" entry —
the ENTRY is merged, both underlying flows are kept intact. (Rides on 0.2.8:
GitLab provider + vitest-unified test runner.)

- **Detection is a pure function, in the ONE web3 module.** `detectWalletChains()`
  (`pkgs/auth/src/web3.ts`) is a pure `window` sniff — EVM = `window.ethereum`,
  Solana = `window.solana`/`solflare`/`backpack` — that returns the
  `ENABLED_WALLET_CHAINS` with an injected provider. Derived from the enabled
  set (one source of truth); testable via an injectable window (no DOM, no
  connect, no I/O). Exported alongside `loginWithWalletChain`.
- **`SocialButtons` renders one entry.** The web3 provider now renders a single
  "Connect Wallet" button (`data-wallet-connect`). On click, `onConnectWallet`
  calls `detectWalletChains()`: exactly one injected chain → connect straight
  (`startWallet(chain)`, no chooser); zero or many → reveal an inline chooser
  (`.hanzo-id-wallet-chains`) of one button per enabled chain
  (`data-chain=evm|solana`) so EITHER chain stays reachable. Same monochrome
  `hanzo-id-social-btn` style as GitHub/GitLab/Google; the chooser is indented
  under the entry. The per-chain path (`startWallet` → `loginWithWalletChain`)
  is UNCHANGED — only the button that reaches it is merged.
- **Verified.** Auth unit tests green (3 new `detectWalletChains` cases:
  single→[chain], both→[evm,solana], none→[]). Playwright against the dev SPA
  (get-app-login intercepted so web3 resolves): one "Connect Wallet" renders;
  click with no injected wallet → chooser shows Ethereum/EVM + Solana; click
  with an injected `window.ethereum` → NO chooser, straight into the EVM flow.
- **Backend untouched.** Pure `id` SPA change (frontend), no IAM edit.
  Ships as `ghcr.io/hanzoai/id:0.2.9`; deploy = bump the operator CR image
  (`universe/infra/k8s/operator/crs/id.yaml`) by hand (id not in the
  gitops-reconcile allowlist). NEVER restart ingress (TLS-outage hazard).

## Provider-hint auto-federation — click GitHub/Google downstream, land straight in the provider (0.2.6)

Clicking "Continue with GitHub/Google" on a downstream app (console.hanzo.ai)
used to bounce the user to the hanzo.id login FORM — the portal ignored the
provider the user already chose. Now it launches that provider immediately.
Three fixes, all reusing the EXISTING `social.ts` hop (no duplicated IdP config);
verified live in-browser (`?provider_hint=provider-github` → github.com,
`provider-google` → accounts.google.com, both `redirect_uri=iam.hanzo.ai/callback`,
`method=signup`, single `provider=`).

1. **`Login.tsx` honors `provider_hint`.** The console SDK already appends
   `&provider_hint=provider-github` (the IAM record `name`) to the authorize
   redirect. A new `federate` phase: after a silent-SSO miss, if the hint is
   present it renders a HEADLESS `<SocialButtons autoStart={hint}>` that
   auto-runs the same hop the button runs — no form flash — and drops to the
   form only if the hint matches no configured provider. Honor ONLY
   `provider_hint`, never bare `provider=` (that carries the SSO SDK's
   `<org>-iam` IDP hint — see the single-provider-state note below).
   `matchProviderHint` (`social.ts`, pure + tested) maps the hint to a provider
   by record name / key (`provider-github` or `github`, case-insensitive).

2. **`getAppLogin` validates against the DOWNSTREAM app's own redirect_uri.**
   `getAppLogin(clientId, redirectUri?)` now sends the incoming OIDC
   `redirect_uri` (read from the query), not the hardcoded
   `${publicOrigin}/callback`. IAM validates it against the app's registered
   list: `hanzo-cloud` (the console's client_id) registers
   `console.hanzo.ai/auth/callback` but NOT `hanzo.id/callback`, so the old
   hardcode made `CheckOAuthLogin` answer `status:error` ("Redirect URI …
   doesn't exist in the allowed list") and the SPA dropped the whole response
   (`status!=='ok'`→null) → NO providers resolved. This blocked the social
   buttons for EVERY cross-app SSO read, not just auto-federation. `SocialButtons`
   reads `redirect_uri` from `window.location.search` (same pattern as the wallet
   path); absent (bare portal / device flow) it defaults to the portal callback.

3. **The interactive hop uses `method=signup` (find-or-create-login).** IAM runs
   find-or-create only under `signup` (`controllers/auth.go:1041`: existing
   3rd-party identity → sign in, else create). `signin` is the account-LINK
   branch (`auth.go:1257`: `GetSessionUsername()==''` → `ResponseError("user
   doesn't exist")`) — it needs a live session and errors on a fresh "Continue
   with GitHub". The old `intent==='signup'?'signup':'signin'` sent `signin` from
   the sign-in page; both intents now use `signup` (intent only changes button
   copy). Latent bug — never exercised end-to-end before this.

Contracts locked in `pkgs/auth/src/{social,client}.test.ts`. Deploy: image
`ghcr.io/hanzoai/id:0.2.6`, operator CR `universe/infra/k8s/operator/crs/id.yaml`
(the `id` CR did not exist in-cluster before — id ran off the raw
`deployment.yaml`; applying the CR handed the Deployment to the operator, safe
because id carries no env, only `envFrom: id-tenant-catalog`). `id` is NOT in the
gitops-reconcile allowlist → apply the CR by hand. Rides on 0.2.5 forced-MFA.

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

## Org-agnostic password login (0.1.23) — SUPERSEDED, do not restore

**This section describes behaviour that no longer works and must not be
reinstated.** It is kept because the reasoning below is what makes the current
design legible, and because someone reading only this section will otherwise
"fix" the apex login straight back into an outage.

iam2 removed cross-org resolution deliberately. It scopes every credential
lookup to one org and treats the collision this design leaned on as a defect —
`internal/registry/registry.go` names it "the F-2 bug where z@hanzo.ai collided
across admin and hanzo", because resolving across orgs coupled lockout counters
between rows and handed out a brute-force oracle on the SuperAdmin. An org-less
`POST /v1/iam/login` is now refused outright:

    HTTP 200  {"status":"error","msg":"organization, username and password are required"}

Note the **200**. The form renders that as though the user's own password were
wrong, and every status-code monitor reads it as healthy. Left unfixed it killed
the bare sign-in on hanzo.id, lux.id, iam.hanzo.ai and pars.id at once while
looking green.

So `LoginForm` now resolves the app's own org via `get-app-login` and posts it on
BOTH entry points — the same thing the 0.2.2 fix below already established for
the downstream-app path. A global admin is no longer reached by omission; they
reach admin/* by signing into an admin-org app (e.g. `hanzo-admin-guard`), which
is the explicit path 0.2.2/0.2.3 describe. `client.login()` stays a pure
passthrough: it never invents an org, it only forwards one.

The original 0.1.23 note follows, for context only.

### (superseded) original text


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

## Truth flows git.hanzo.ai -> GitHub (2026-07-26)

`hanzoai/id` is CANONICAL on git.hanzo.ai (`mirror:false`, default `main`).
GitHub is a **push-mirror** of it, `sync_on_commit: true` with an 8h floor —
push here and GitHub follows on its own.

It used to be the reverse, and that was the bug: as a pull-mirror this repo
could run no CI at all, so `.hanzo/workflows` never fired and four commits
shipped zero images without a single red signal. Do not re-point the sync.

Builds publish to BOTH `oci.hanzo.ai/id` (ours, the destination) and
`ghcr.io/hanzoai/id` (kept so a rollback target always resolves), tagged from
`package.json` — a release IS a version bump. Deploying is a `spec.image.tag`
edit in `universe/infra/k8s/operator/crs/id.yaml`; CI must never patch that CR
itself, because Hanzo CD reverts it within ~90s.
