# syntax=docker/dockerfile:1.7
# Hanzo ID — Vite SPA built once, served by hanzoai/spa.
FROM node:24-alpine AS build
WORKDIR /build
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

# Copy the full workspace first, then install. pnpm links each package's
# node_modules as symlinks into the root .pnpm store; a later `COPY apps apps`
# over an already-installed tree drops those symlinks (.dockerignore excludes
# node_modules), so install must run AFTER all source is present.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps apps
COPY pkgs pkgs
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @hanzo/id-web build

# SPA server stage — hanzoai/spa serves /public on :3000 with index.html
# fallback for client-side routing and an SPA-safe CSP (frame-ancestors
# 'none' only). Must NOT be hanzoai/static: its default CSP is
# `default-src 'none'` (no script-src/connect-src), which blanks the SPA
# and blocks fetch() to IAM.
FROM ghcr.io/hanzoai/spa:1.2.0
COPY --from=build /build/apps/web/dist /public
EXPOSE 3000
