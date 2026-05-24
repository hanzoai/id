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
RUN pnpm install --frozen-lockfile=false

COPY apps apps
COPY pkgs pkgs
RUN pnpm --filter @hanzo/id-web build

# SPA runtime — hanzoai/spa is SPA-mode-always-on, smart caching,
# templates /public/config.json from SPA_* env vars at startup.
FROM ghcr.io/hanzoai/spa:1.2.0
COPY --from=build /build/apps/web/dist /public
EXPOSE 3000
