# LLM.md — Hanzo ID

## What this is

**Brand-neutral** white-label identity portal. Vite SPA, ships ZERO
brand-specific data. Every per-tenant value — orgId, brandUrl, clientId,
appName — comes from the runtime catalog (K8s ConfigMap) or is derived
from the hostname at request time.

One image serves any identity host. Adding a brand never touches this repo.

Replaces:
- `~/work/hanzo/hanzo.id-worker` (Cloudflare Worker) — decommissioned
- `~/work/hanzo/id/legacy-nextjs/` (Next.js 15) — frozen, kept for diff

## Architecture

```
DNS                       →  hanzo cluster ingress (129.212.164.5)
any-host.id           ──┐
id.any-host.net       ──┤  ─ TLS ─→  ingress ─ K8s ─→  Service id ─→  Deployment id
www.any-host.id       ──┘            (Traefik)                       ghcr.io/hanzoai/id:vX.Y.Z
                                                                          │
                                                                          │ on boot:
                                                                          │   GET /config.json (templated from SPA_IAM_TENANT_CONFIG_JSON)
                                                                          │   ↓
                                                                          │   window.__ID_CATALOG__
                                                                          ▼
                                                                     resolveTenant(hostname)
                                                                       catalog ?? derive-from-hostname
                                                                          ▼
                                                                     loadBrand(tenant.brandUrl)
                                                                       fetch absolute URL (jsdelivr, etc.)
                                                                          ▼
                                                                     createAuthClient(tenant)
                                                                          ▼
                                                                     IAM backend (same-origin /v1/iam/*)
```

## Workspace

```
apps/
  web/          @hanzo/id-web    — Vite + React 19 + @hanzo/gui SPA. No brand deps.
pkgs/
  shared/       @hanzo/id-shared — TenantConfig (brandUrl, not brandPackage)
                                   + resolveTenant + parseCatalog + loadBrand
  auth/         @hanzo/id-auth   — composable login/signup/OTP forms
  idv/          @hanzo/id-idv    — pluggable identity verification (stub/persona/onfido/veriff)
legacy-nextjs/  Frozen predecessor.
```

## Brand resolution (3 layers, first non-empty wins)

1. **Runtime catalog** — `window.__ID_CATALOG__` populated from `/config.json`
   (templated by hanzoai/spa at pod startup from `SPA_IAM_TENANT_CONFIG_JSON`).
   This is the standard production path. Each deploy ships a `ConfigMap` with
   its full host → tenant map.
2. **Hostname-derived defaults** — `foo.id` / `id.foo.net` / `iam.foo.net` /
   `www.foo.id` all derive `orgId=foo`, `clientId=foo-id-portal`,
   `appName=foo-id`, `brandUrl=https://cdn.jsdelivr.net/npm/@foo/brand@latest/brand.json`.
   Works out of the box when the npm scope matches the org. The catalog
   handles mismatches (`lux → @luxfi/brand`, `pars → @parsdao/brand`,
   `zoo → @zooai/brand`, `zoolabs.id → org=zoo`).
3. The Hanzo deployment's catalog lives at
   `apps/web/k8s/tenant-catalog.yaml`. Other consumers (Liquidity,
   ad.nexus, bootno.de, ...) ship their own ConfigMap.

## Local dev

```bash
pnpm install
pnpm dev
```

For multi-host preview without a deployed catalog, the hostname-derived
defaults render the matching brand pkg from jsDelivr.

For an in-cluster preview with the full catalog, just hit the production
hostnames (hostname → 129.212.164.5).

## Build + deploy

CI publishes images on tag push. Universe auto-bumps the manifest
(`infra/k8s/operator/crs/hanzo-platform.yaml` `images:` override) on
green CI.

Manual:
```bash
docker build -t ghcr.io/hanzoai/id:X.Y.Z .
docker push ghcr.io/hanzoai/id:X.Y.Z
kubectl apply -k apps/web/k8s
```

## Adding a brand

Brand maintainer:
1. Publish a brand package to npm exposing `brand.json`. Convention:
   `@<org>/brand` containing
   `{ "brand": { name, title, description, appDomain, logoUrl, faviconUrl, ... } }`.
   `logoUrl` and `faviconUrl` are absolute (CDN — jsDelivr works).

Deploy maintainer:
2. Add the host(s) to `apps/web/k8s/tenant-catalog.yaml` with
   `orgId` / `clientId` / `appName` / `brandUrl`. No source change.
3. Add the host to `apps/web/k8s/ingress.yaml` for cert-manager TLS.
4. DNS → cluster ingress IP.

The image never changes. There is no `pnpm add @brand/foo`, no
`vite.config.ts` edit, no `tenant.ts` edit.

## Plugging an IDV provider

```ts
import { registerProvider, createPersonaProvider } from '@hanzo/id-idv'
registerProvider(createPersonaProvider({ templateId, apiKey, environment: 'production' }))
```

| id | source | docs |
|---|---|---|
| `stub` | `@hanzo/id-idv/providers/stub` | in-memory, dev-only |
| `persona` | `@hanzo/id-idv/providers/persona` | https://docs.withpersona.com |
| `onfido` | `@hanzo/id-idv/providers/onfido` | https://documentation.onfido.com |
| `veriff` | `@hanzo/id-idv/providers/veriff` | https://developers.veriff.com |

## Backend

Go IAM backend at `~/work/hanzo/iam` (image `ghcr.io/hanzoai/iam`).
This portal talks to it same-origin via Traefik file routes per-host
(`/v1/iam/*` and `/oauth/*` paths on every identity hostname are
proxied to the IAM service; the rest goes to this SPA).
