# syntax=docker/dockerfile:1.7
# Hanzo ID — Vite SPA built once, served by hanzoai/static.
FROM node:24-alpine AS build
WORKDIR /build
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY pkgs/shared/package.json pkgs/shared/
COPY pkgs/auth/package.json pkgs/auth/
COPY pkgs/idv/package.json pkgs/idv/
COPY pkgs/onboarding/package.json pkgs/onboarding/
RUN pnpm install --frozen-lockfile=false

COPY apps apps
COPY pkgs pkgs
RUN pnpm --filter @hanzo/id-web build

# Static server stage — hanzoai/static (FROM scratch, ENTRYPOINT ["/static"]).
# The binary defaults to -root /public -port 3000 and, on boot, templates
# /public/config.json from SPA_* env (the id-tenant-catalog ConfigMap supplies
# SPA_IAM_TENANT_CONFIG_JSON). So the SPA MUST live at /public, and -spa must be
# on so client-routed paths (/auth/*, /callback) fall back to index.html.
FROM ghcr.io/hanzoai/static:0.4.1
COPY --from=build /build/apps/web/dist /public
EXPOSE 3000
CMD ["--spa", "--port", "3000", "--root", "/public"]
