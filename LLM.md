# LLM.md — Hanzo ID

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

## The tenant catalog was never read — one key name, every host (0.2.21)

`/config.json` is served by `hanzoai/spa`, which derives its JSON key
**mechanically from the env var we supply**: `SPA_IAM_TENANT_CONFIG_JSON`
(ConfigMap `id-tenant-catalog`) becomes `iamTenantConfigJson`. The
`TenantConfig`→`OrgConfig` rename swept through this codebase and renamed the
READ too — `cfg.iamOrgConfigJson`, a key nothing emits. The fetch returned 200,
the field was `undefined`, `resolveOrg` fell back, and nothing logged. Verified
live: `https://hanzo.id/config.json` returns `iamTenantConfigJson`, and the SPA
was reading straight past it.

The env var is the interface and it is NOT ours to rename unilaterally — the
ConfigMap, the Deployment's `envFrom` and the spa image all speak it. Code
follows the interface, so the read moved to `catalogOf` in `pkgs/shared/src/
org.ts`, next to the resolver it feeds, pinned by tests that fail on the old
spelling.

Two live consequences, and the first is why this shipped with 0.2.20:

- **hanzo.id authenticated as the wrong app.** The catalog maps it to
  `hanzo-console` (`enableSignUp: true`); with no catalog it fell to the built-in
  `hanzo-id` (**false**). Federation PROVISIONS a local user for a new identity,
  so a first-time GitHub user was refused "the application does not allow to sign
  up new account" — the 0.2.20 fix working perfectly and still failing the exact
  people it was for. `enableSignUp` itself needed no change; reading the catalog
  did.
- **Every catalog-ONLY host resolved nothing.** osage.id, zoolabs.id,
  id.zoo.network, id.lux.network, iam.lux.network, id.pars.network, id.bootno.de
  and iam.hanzo.ai have no built-in entry, so they got `hostSkeleton` — empty
  `clientId`, no application. That the resolver fails CLOSED there is why it leaked
  no brand (the osage.id regression stayed fixed); it is also why it was silent.

Declared state was corrected to match: `hanzo-console` now lists
`https://hanzo.id/callback` in `init_data.json`. The live row already had it, and
`seed.go` deliberately keeps `redirectUris` off `appPolicyKeys` ("the registration
surface, which drifts legitimately and is owned elsewhere") so nothing reverts —
but redirectUris ARE applied on CREATE, and from 0.2.21 hanzo.id authenticates as
`hanzo-console` against that exact callback. Without the line, a REBUILT cluster
would come up unable to sign anyone in at hanzo.id.

The shape to remember: a rename is not finished at the language boundary. This
one crossed into an env var, a ConfigMap key and a base image's templating
convention, none of which the compiler or the type system can see — and the
failure mode was a successful fetch of a field that wasn't there.

## Social sign-in goes through IAM, because it always did (0.2.20)

GitHub sign-in reached GitHub, succeeded there, and then dead-ended: the user
landed back on hanzo.id and was told to sign in first. That message is IAM's
`please sign in first` — a 401 from `/v1/iam/onboard`, reached with no session
and no bearer. The SPA had never obtained a token.

**The SPA was the relying party, and it cannot be one.** `social.ts` built the
IdP URL in the browser (`github.com/login/oauth/authorize`, `redirect_uri=
${origin}/callback`) against a contract copied from an IAM fork whose front end
no longer exists. GitHub then returned a GitHub code to the SPA's own
`/callback` — and **nothing can spend that code**: exchanging it needs the client
SECRET, which a browser must never hold, and IAM has no endpoint that takes a raw
provider code. `Callback.tsx` POSTed it to `/v1/iam/login`, which does password,
device approval and code minting, and knows nothing about providers. So every
social sign-in ended authenticated at GitHub and anonymous here.

**IAM already implements the whole flow and was never called.**
`internal/oidc/federation.go` is a complete OAuth2/OIDC relying party. Naming a
`provider` on the authorize endpoint IS the entry point: `authorizeHandler`
validates client_id, the EXACT redirect_uri and the PKCE policy, then
`beginFederation` resolves the provider, mints a single-use transaction, sets a
browser-binding cookie and sends the browser to the IdP. The IdP returns to
**IAM's** fixed callback, `/v1/iam/oauth/callback`, where IAM — holding the
secret — exchanges the code, links or provisions the user, and mints an IAM
authorization code bound to the original PKCE challenge, redirect_uri and nonce.
`OAuthAuthorizeRequest.provider` had been declared in the SPA's own types the
whole time; `authorize()` simply never emitted it. The fix is that one parameter,
plus deleting everything that existed to work around its absence.

**`provider` is the RECORD name — `provider-github`, never `github`.**
`federationProvider` matches `ProviderItem.Name` exactly, and `EnrichProviders`
resolves that same name to the record, so the two are one string by construction.
Verified live: `?provider=github` → `invalid_request: unknown or unavailable
provider`; `?provider=provider-github` → 302 to GitHub. A comment on
`providerKey` used to assert the opposite; it is now corrected in place. The bare
key is a DISPLAY key (icon, label, `provider_hint` matching) and nothing else.

**Two arms, and they are the two the password path already had.** The question is
only who owns the PKCE verifier (`SocialButtons.hop`):

- **An app sent the user here** (`redirect_uri` on the query) → re-enter authorize
  with THAT app's request via `social.ts::authorizeRequest`, so IAM mints the code
  against its client_id, redirect_uri and challenge and returns the browser
  straight to it. The app holds the verifier; this portal is never in the return
  path and never touches a token. Same branch as `Login.completeAfterAuth`.
- **A bare portal sign-in** → `createIam(...).signinRedirect({additionalParams:
  {provider}})`. The SDK generates and persists the verifier in **localStorage**
  (`txStorage`, keyed `hanzo_iam_code_verifier:<state>` — localStorage, not
  session, deliberately, so it survives the full-page redirect), and
  `handleCallback` reads back that exact slot. IAM returns the APP's state
  (`federationMint` sets `state` from `AppState`, not its IdP-leg state), so the
  SDK's state check matches.

Deleted, all of it dead once the browser stops being the relying party: the IdP
endpoint/scope table, `buildProviderAuthUrl`, `startProviderLogin`,
`isHoppableProvider`, `encodeState`/`decodeState`, `client.providerLogin`,
`ProviderExchangeRequest`, and `Callback.tsx`'s provider branch. `/callback` now
has ONE case — an ordinary IAM code — because a federated return is
indistinguishable from any other.

Verified in a real browser against live IAM (local bundle, `/config.json`
pointing `localhost` at `https://hanzo.id`; port 5173 because
`http://localhost:5173/callback` is registered on `hanzo-id`):

- bare-portal click → `hanzo.id/v1/iam/oauth/authorize?…&provider=provider-github`
  → 302 → GitHub, with `redirect_uri=https://hanzo.id/v1/iam/oauth/callback` and
  the `hanzo_fed` cookie (`SameSite=Lax`, `path=/v1/iam/oauth/callback`, 600s);
  a verifier slot appears keyed by state.
- app-initiated click → same, and NO verifier slot is created — proof the app's
  own request was forwarded rather than the portal starting its own flow.
- return leg → `/callback?code=…&state=<stored>` consumes the slot and POSTs
  `/v1/iam/oauth/token`, which answers `invalid_grant: invalid authorization
  code` for a deliberately fake code. The exchange is wired; only the code was
  false.

Not exercisable here: the GitHub login itself. See the registration note under
"Social providers" below — GitHub defers redirect_uri validation until after
sign-in, so an unauthenticated probe CANNOT tell a registered callback from an
unregistered one (a deliberately bogus URL returns the identical 302).

## Provider-hint auto-federation — click GitHub/Google downstream, land straight in the provider (0.2.6)

Clicking "Continue with GitHub/Google" on a downstream app (console.hanzo.ai)
used to bounce the user to the hanzo.id login FORM — the portal ignored the
provider the user already chose. Now it launches that provider immediately.
Three fixes. Points 1 and 2 still hold; point 3 and every mention of the "hop"
below are **superseded by 0.2.20** — the hop is gone, the auto-launch now starts
IAM's federation like the button does, and `method` is not a parameter of it
(IAM's federation callback links-or-provisions on its own).

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

> **Superseded by 0.2.20.** Bug A (read the provider identity from the NESTED
> record) still holds and still ships. Everything below about the base64 `state`,
> `buildProviderAuthUrl` and `providerLogin` describes the browser-side IdP hop,
> which is gone — the browser no longer builds an IdP URL or handles a provider
> code, so neither bug can recur. Kept because it records how the flow was
> misdiagnosed twice: each fix made the SPA a slightly better relying party, when
> the SPA could never be one at all.

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

### Social providers — render only when configured; federate through IAM

`SocialButtons` renders ONLY providers IAM holds a REAL credential for
(`AppProvider.configured` = non-placeholder clientId), so a placeholder-seeded
provider is hidden rather than dead-ending; it reappears once real creds land.
IAM applies the same rule server-side (`isConfigured`), so a hidden provider is
also refused at authorize — the two agree without sharing a table. Clicking a
configured provider names it on IAM's authorize endpoint and IAM runs the entire
IdP leg; see "Social sign-in goes through IAM" above. This browser never builds
an IdP URL, never sees a provider code, and holds no secret.

**The callback the IdP must have registered is IAM's, not the SPA's.** One fixed
path, every provider, per brand host:

    https://<brand>/v1/iam/oauth/callback     ← register THIS at GitHub/Google

(`PathFederationCallback`; the origin is the brand's pinned issuer, resolved from
the trusted request host — `hanzo.id` federates to `hanzo.id/v1/iam/oauth/
callback`, lux.id to its own, and so on.) It is NOT `/v1/iam/callback` (that path
does not exist — an earlier revision of this file said so and was wrong) and NOT
`https://<brand>/callback`, which is the APP's authorize redirect and belongs to
the app's registered `redirectUris` in `init_data.json`, a different list for a
different leg.

Beware verifying this from outside: **GitHub defers redirect_uri validation until
after the user signs in**, so an unauthenticated request to
`github.com/login/oauth/authorize` 302s to the login page whether the callback is
registered or not — a deliberately unregistered URL behaves identically. The only
sound check is the GitHub App's own settings page.

Credentials live in KMS at project `hanzo-iam`, env `prod`, keys
`IAM_GITHUB_CLIENT_ID` / `IAM_GITHUB_CLIENT_SECRET` (and `IAM_GOOGLE_*`). The
`iam-kms-sync` KMSSecret (`universe/infra/k8s/iam/secret.yaml`) syncs that path
into `iam-secrets`; `init_data.json` substitutes `${IAM_GITHUB_CLIENT_ID}` at
deploy. That chain already works — GitHub and Google both carry real values
today; `provider-web3` and `provider-apple` are still placeholders and stay
hidden.

**`enableSignUp` gates a FIRST-TIME federated user.** Federation provisions a
local user when the identity is new, so an app with `enableSignUp:false` refuses
a first-time GitHub user with "the application does not allow to sign up new
account" — a sign-in failure that has nothing to do with the flow being wired.
Live: `hanzo-console` and `hanzo-app` are true; `hanzo-id` and `hanzo-cloud` are
false. `hanzo.id` sends `clientId: hanzo-console` (`universe/infra/k8s/id/
configmap.yaml`), so the portal is on a signup-permitting app. It is governed
declaratively in `universe/infra/k8s/iam/init_data.json` and reconciled every
boot (`iam/internal/seed/seed.go`, `appPolicyKeys`) — change it THERE, never by
an admin call, which the next boot would revert.

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
