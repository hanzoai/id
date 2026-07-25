# syntax=docker/dockerfile:1.7
# Hanzo ID — Vite SPA built once, served by hanzoai/spa.
FROM node:24-alpine AS build
WORKDIR /build
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY pkgs/shared/package.json pkgs/shared/
COPY pkgs/auth/package.json pkgs/auth/
COPY pkgs/connect/package.json pkgs/connect/
COPY pkgs/idv/package.json pkgs/idv/
COPY pkgs/onboarding/package.json pkgs/onboarding/
RUN pnpm install --frozen-lockfile=false

COPY apps apps
COPY pkgs pkgs
RUN pnpm --filter @hanzo/id-web build

# SPA server stage — hanzoai/spa is the correct base for a Vite SPA:
# history-API fallthrough for client-side routes AND a SPA-safe CSP.
# hanzoai/static defaults to `Content-Security-Policy: default-src 'none'`
# (built for static assets, not an app that loads its own bundle), which
# blocks the SPA's own scripts and leaves a blank page. hanzoai/spa serves
# index.html for all routes with a sane CSP. Defaults: PORT=3000, ROOT=/public.
FROM ghcr.io/hanzoai/spa:1.4.8
COPY --from=build /build/apps/web/dist /public
EXPOSE 3000
