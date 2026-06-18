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

# Static server stage — hanzoai/static reads /spa for assets
FROM ghcr.io/hanzoai/static:0.4.1
COPY --from=build /build/apps/web/dist /spa
EXPOSE 3000
# hanzoai/static reads -root/-spa as FLAGS (ROOT/PORT env are ignored);
# default port 3000 matches the id deploy probe.
ENTRYPOINT ["/static", "-root", "/spa", "-spa"]
