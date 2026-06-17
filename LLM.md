# LLM.md — Hanzo ID

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
                                                  https://iam.hanzo.ai (Casdoor fork, Go)
                                                                 │
                                                                 ▼
                                                  iam-* postgres in hanzo namespace
```

## Workspace

```
apps/
  web/          @hanzo/id-web  — Vite + React 19 + @hanzo/gui SPA
pkgs/
  shared/       @hanzo/id-shared — TenantConfig, resolveTenant, loadBrand
  auth/         @hanzo/id-auth   — composable login/signup/OTP forms +
                                   AuthClient (wraps @hanzo/iam REST)
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
`github.com/hanzoai/iam`, image `ghcr.io/hanzoai/iam`). This portal talks
to it via the routes in `pkgs/auth/src/client.ts`:

- `/v1/iam/login` `/v1/iam/signup` `/v1/iam/send-verification-code`
- `/oauth/authorize` `/oauth/token` `/oauth/logout`

All hostnames talk to the same IAM backend — the org is carried in the
request body (`organization: <orgId>`), and the IAM backend tenant-scopes
on that.
