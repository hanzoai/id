# LLM.md - Hanzo Id

## Overview
White-label login portal for Hanzo IAM — forkable, multi-tenant,
RFC-compliant OAuth2/OIDC. Any domain pointing at a deployment gets a
working sign-in experience. Next.js 15 + Edge runtime, served on Cloudflare
Pages or as a Docker image (`ghcr.io/hanzoai/id`).

## Tech Stack
- **Language**: TypeScript (Next.js 15, React 19)
- **Runtime**: Edge (Cloudflare Pages) — every page declares `runtime = 'edge'`.

## Build & Run
```bash
pnpm install && pnpm build
pnpm dev   # http://localhost:3000
```

## Structure
```
id/
  Dockerfile
  README.md
  app/             — Next.js App Router pages + api routes
  components/      — LoginForm, SignUpForm, MarketingPanel, …
  lib/
    config.ts      — TENANT RESOLVER (single source of truth)
    iam.ts         — Thin wrapper exposing getIamUrl/getOrg/getDefaultClientId
    branding.ts    — Visual branding overlay (logos/colors/copy)
    oauth.ts       — PKCE flow, token exchange, userinfo
    clients.ts     — clientId → application/org map for social callbacks
  middleware.ts    — Multi-tenant proxy layer (uses lib/config)
  next.config.ts
  wrangler.toml    — Cloudflare Pages config
```

## Tenant resolution (canonical)

There is **one and only one** path for hostname → tenant resolution:
`lib/config.ts::resolveTenant(host)`. It returns a fully-resolved
`TenantConfig` (`iamUrl`, `iamIssuer`, `orgId`, `clientId`, `appName`,
`publicOrigin`) by composing, in order:

1. JSON catalog from `IAM_TENANT_CONFIG_JSON` env (or
   `IAM_TENANT_CONFIG_PATH` file, Node runtime only) — keyed by exact host
   or the stripped form (`id.<apex>` → `<apex>`).
2. Process env (`IAM_URL`, `IAM_ORG`, `IAM_CLIENT_ID`, `IAM_APP_NAME`,
   `IAM_ISSUER`, `PUBLIC_ORIGIN`).
3. Hostname-derived defaults (local hosts get `http://localhost:8000`,
   remote hosts get `https://iam.hanzo.ai`).

**No source-coded hostname switch lives anywhere else.** Adding a tenant is
an env / ConfigMap change, never a code change. Reference:
`~/work/hanzo/iam/docs/CONVENTION.md` §2 + §6.

### Browser SPA mode

When fronted by `ghcr.io/hanzoai/spa` v1.1+, the SPA fetches `/config.json`
at boot (rendered from `SPA_*` env on the container) and
`loadBrowserConfig()` caches the result. Client components call
`getBrowserConfig()` afterwards.

## Cloudflare Worker (`~/work/hanzo/hanzo.id-worker`)

Separate repo for the legacy CF Worker on hanzo.id. Same env-driven pattern:
`env.IAM_TENANT_CONFIG_JSON` + `env.IAM_DEFAULT_ORG` (set in
`wrangler.toml [vars]`). The `DOMAIN_ORG_MAP` constant is gone — the worker
calls `getOrgBrand(hostname, env)` and reads the catalog from env.

## Forbidden patterns
- Hardcoded `'hanzo.id' → 'https://iam.hanzo.ai'` maps in source.
- `if (host === 'lux.id')` branches anywhere.
- `NEXT_PUBLIC_*` for env-specific URLs (build-time injection — use
  `/config.json` at runtime instead).
- Adding `staticBranding[...]` to drive auth routing (that map is
  visual-only; auth routes through `lib/config.ts`).

## Key Files
- `README.md` — Project documentation
- `.env.example` — Canonical env var list
- `lib/config.ts` — Tenant resolver (THE source of truth)
- `middleware.ts` — Multi-tenant proxy (consumer of the resolver)
- `Dockerfile` — Container build
