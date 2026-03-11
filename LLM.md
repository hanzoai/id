# LLM.md - Hanzo Id

## Overview
White-label login portal for Hanzo IAM - forkable, multi-tenant, RFC-compliant OAuth2/OIDC

## Tech Stack
- **Language**: TypeScript/JavaScript

## Build & Run
```bash
pnpm install && pnpm build
pnpm test
```

## Structure
```
id/
  Dockerfile
  LICENSE
  README.md
  app/
  components/
  config/
  lib/
  middleware.ts
  next-env.d.ts
  next.config.ts
  package.json
  pnpm-lock.yaml
  postcss.config.mjs
  public/
  scripts/
```

## Key Files
- `README.md` -- Project documentation
- `package.json` -- Dependencies and scripts
- `Dockerfile` -- Container build
