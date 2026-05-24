# Hanzo ID - Hosted Login Pages

Configurable, white-label login pages for Hanzo IAM. Each organization can customize their login experience based on their domain (CNAME).

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  hanzo.id   │     │   pars.id   │     │   lux.id    │
│  (CNAME)    │     │   (CNAME)   │     │   (CNAME)   │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┴───────────────────┘
                           │
                    ┌──────▼──────┐
                    │   Hanzo ID   │  ← This repo (frontend)
                    │   (Next.js)  │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  Hanzo IAM  │  ← Backend auth services
                    │   (Go API)  │
                    └─────────────┘
```

## Features

- **Domain-based branding**: Logo, colors, content based on CNAME
- **Configurable auth methods**: Password, code, WebAuthn, Face ID
- **Social providers**: Google, GitHub, and more
- **Customizable content**: Quotes, testimonials, feature highlights
- **Dark mode by default**: Clean, modern design
- **Easy to fork**: Simple structure for white-labeling

## Configuration

### Tenant resolution (env / catalog driven)

Hanzo ID is white-label: any domain pointing at a deployment gets a working
OIDC/OAuth2 provider. Tenants resolve per-request via
[`lib/config.ts::resolveTenant`](./lib/config.ts) — **no hardcoded
hostname switches in source code**.

```
┌────────────────────────────┐
│ Request host (`Host` hdr)  │
└────────────┬───────────────┘
             ▼
┌───────────────────────────────────────────────────────────────┐
│ resolveTenant(host):                                          │
│  1. Catalog entry      (env IAM_TENANT_CONFIG_JSON / _PATH)   │
│  2. Process env        (IAM_URL, IAM_ORG, IAM_CLIENT_ID, …)   │
│  3. Hostname-derived defaults                                 │
└───────────────────────────────────────────────────────────────┘
             ▼
┌────────────────────────────┐
│ TenantConfig (iamUrl, …)   │
└────────────────────────────┘
```

Single-tenant deploys only need section 1 of `.env.example`. Multi-tenant
deploys (one image, many hosts) provide `IAM_TENANT_CONFIG_JSON`. See
`.env.example` for the full schema and `~/work/hanzo/iam/docs/CONVENTION.md`
for the canonical convention.

### Branding (visual, per-host)

The visual branding overlay (logos, colors, marketing copy) lives in
[`lib/branding.ts`](./lib/branding.ts). It is **per-host** — that file IS
the catalog of tenants we ship logos for. To add a tenant's visuals:

```typescript
export const staticBranding: Record<string, Partial<BrandingConfig>> = {
  'your-domain.com': {
    orgId: 'your-org',
    orgName: 'Your Organization',
    logo: '/logos/your-logo.svg',
    colors: { primary: '#3b82f6', /* … */ },
    content: { title: 'Welcome', subtitle: 'Sign in' },
  },
}
```

Runtime-extensible: ship additional tenants via `TENANT_BRANDING_JSON`
without modifying source.

The IAM backend can also serve branding dynamically:

```
GET ${IAM_URL}/api/branding?domain=your-domain.com
```

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Environment Variables

See [`.env.example`](./.env.example) for the canonical list. The short
version (canonical names per `~/work/hanzo/iam/docs/CONVENTION.md` §2):

| Var | Purpose | Default |
|---|---|---|
| `IAM_URL` | IAM backend origin | `http://localhost:8000` (local) / `https://iam.hanzo.ai` (remote) |
| `IAM_ISSUER` | Pinned OIDC issuer claim | same as `IAM_URL` |
| `IAM_ORG` | Tenant org slug | `hanzo` |
| `IAM_CLIENT_ID` | Default OAuth client_id | `<org>-id` |
| `IAM_APP_NAME` | IAM application name | same as `IAM_CLIENT_ID` |
| `IAM_TENANT_CONFIG_JSON` | Multi-tenant catalog (JSON) | unset |
| `IAM_TENANT_CONFIG_PATH` | Multi-tenant catalog file path | unset |
| `PUBLIC_ORIGIN` | This deployment's canonical public origin | `https://<request-host>` |

For browser-side SPA deployments, the
[`ghcr.io/hanzoai/spa`](https://github.com/hanzoai/spa) v1.1+ image renders
`/config.json` at pod startup from `SPA_*` env vars. The SPA reads this via
`lib/config.ts::loadBrowserConfig()` before mounting React.

## Forking for White-Label

1. Fork this repository
2. Update `lib/branding.ts` with your default branding
3. Add your logo to `public/logos/`
4. Update `app/globals.css` for custom styling
5. Deploy to your infrastructure

## Directory Structure

```
hanzo-id/
├── app/
│   ├── layout.tsx      # Root layout with metadata
│   ├── page.tsx        # Redirects to /login
│   ├── login/
│   │   └── page.tsx    # Main login page
│   ├── signup/         # Sign up page
│   ├── forgot-password # Password reset
│   └── callback/       # OAuth callback handler
├── components/
│   ├── LoginForm.tsx   # Login form component
│   └── MarketingPanel.tsx  # Right side marketing content
├── lib/
│   └── branding.ts     # Branding configuration
├── public/
│   └── logos/          # Organization logos
└── config/             # Additional configuration
```

## License

MIT - Fork and customize freely!
