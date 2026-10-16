# syntax=docker/dockerfile:1.7
# Hanzo ID — Vite SPA built once, served by hanzoai/spa.
FROM node:24-alpine AS build
WORKDIR /build
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

# THE LOCKFILE SHIPS, and the install is frozen to it.
#
# This used to omit pnpm-lock.yaml and run `--frozen-lockfile=false`, so the
# image resolved the whole tree FRESH on every build while `pnpm test` on the
# runner resolved it from the lockfile. Two different dependency graphs from one
# commit: the tested one, and the shipped one. It went green for as long as free
# resolution happened to agree, and stopped the moment it did not — adding one
# dependency (@hanzo/event) moved vite from the lockfile's
# 7.3.5_@types+node@25.9.3_… to 7.3.6_@types+node@22.20.1 and the build died on
# `Cannot find module '/build/apps/web/node_modules/vite/bin/vite.js'`. Nothing
# was wrong with the source: the same commit builds cleanly when installed from
# the lockfile.
#
# A resolver free to drift ships a bundle no one has run. Frozen, the image gets
# the exact tree the tests passed against, and a lockfile that has gone stale
# fails HERE — loudly, naming the mismatch — instead of silently building
# something else.
#
# EVERY workspace member's package.json must be present before a frozen install:
# pnpm validates the lockfile against all of them and refuses if one is missing.
# apps/account is not built into this image, but it IS in the workspace, so its
# manifest is required for the check to pass.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/account/package.json apps/account/
COPY pkgs/shared/package.json pkgs/shared/
COPY pkgs/auth/package.json pkgs/auth/
COPY pkgs/connect/package.json pkgs/connect/
COPY pkgs/idv/package.json pkgs/idv/
COPY pkgs/onboarding/package.json pkgs/onboarding/
RUN pnpm install --frozen-lockfile

COPY apps apps
COPY pkgs pkgs

# NO ingest key is built in, and the assertion below is what keeps it that way.
#
# This image is BRAND-NEUTRAL: one build serves hanzo.id, lux.id, zoolabs.id,
# pars.id, osage.id, id.bootno.de and every alias. A key inlined here is
# therefore ONE brand's key on ALL of them, and it was — Hanzo's — so a week of
# Lux, Zoo, Osage, Pars and Bootnode sign-in traffic was filed in Hanzo's
# project, where the brands whose visitors it was could not read it.
#
# The key is a per-ORG fact and is read at request time from the runtime config
# the host is served with (`ingestKeyring` in /config.json, from the
# id-tenant-catalog ConfigMap; pkgs/shared/src/ingest.ts resolves it through the
# SAME `resolveOrg` that already decides the brand). Adding a brand is a catalog
# edit, not a rebuild.
#
# The old build-arg gate asserted the OPPOSITE — that a pk- literal WAS present
# in dist — so this assertion is deliberately its inverse and stands in the same
# place. A publishable key can only re-enter this bundle by someone hardcoding
# one, and a hardcoded key is invisible in review and silent in production:
# every brand keeps reporting, just to the wrong tenant.
#
# Two sources may put a key in dist, and the allowance is read from each rather
# than listed here: the runtime keyring the site export serves
# (public/config.json), and @hanzo/event's own HOST-keyed table (org.ts
# ORG_KEY/SITE_KEY), which picks a key by the page's hostname and so never
# names one brand on another's host. Any other key fails the build.
#
# The library's table is allowed in dist, never reached from this app's source:
# a key the app names itself is one brand's key on every host, whichever table
# it was copied from. So the source this image ships — the app and the
# workspace packages, tests aside, public/ beside the keyring, index.html,
# vite.config.ts and any .env — names no publishable key at all (a placeholder
# made only of x aside), and the app never names the library's own key lookups
# (ORG_KEY, SITE_KEY, keyFor, keyForPage, siteKey).
#
# `&&`, not `;`: with `;` the RUN exits with the status of the LAST command and a
# failed build would be masked.
RUN pnpm --filter @hanzo/id-web build && \
    cat apps/web/public/config.json apps/web/node_modules/@hanzo/event/dist/index.mjs | grep -ohE 'pk-[A-Za-z0-9_-]{16,}' | sort -u > /tmp/keys && \
    { ! grep -rohE 'pk-[A-Za-z0-9_-]{16,}' apps/web/dist | grep -vxFf /tmp/keys | grep -q . || \
      { echo "ERROR: a publishable key is baked into apps/web/dist - this image serves every brand, so a built-in key attributes all of them to one tenant. Keys belong in the runtime ingestKeyring." >&2; exit 1; }; } && \
    { find apps/web/src apps/web/public pkgs/*/src -type f ! -name '*.test.*' ! -name '*.spec.*' ! -path apps/web/public/config.json; ls -d apps/web/index.html apps/web/vite.config.ts apps/web/.env* 2>/dev/null || true; } > /tmp/shipped && \
    { ! xargs grep -ohE 'pk-[A-Za-z0-9_-]{16,}' < /tmp/shipped | grep -vE '^pk-x+$' | grep -q . || \
      { echo "ERROR: the source names a publishable key - a key in the source is one brand's key on every host. Keys belong in the runtime ingestKeyring." >&2; exit 1; }; } && \
    { ! grep -E '^(apps/web/src|pkgs/[^/]+/src)/' /tmp/shipped | xargs grep -lwE 'ORG_KEY|SITE_KEY|keyFor|keyForPage|siteKey' | grep -q . || \
      { echo "ERROR: the source names one of @hanzo/event's own key lookups - this portal's key comes from the runtime ingestKeyring alone." >&2; exit 1; }; }

# SPA server stage — hanzoai/spa is the correct base for a Vite SPA:
# history-API fallthrough for client-side routes AND a SPA-safe CSP.
# hanzoai/static defaults to `Content-Security-Policy: default-src 'none'`
# (built for static assets, not an app that loads its own bundle), which
# blocks the SPA's own scripts and leaves a blank page. hanzoai/spa serves
# index.html for all routes with a sane CSP. Defaults: PORT=3000, ROOT=/public.
FROM ghcr.io/hanzoai/spa:1.4.13
COPY --from=build /build/apps/web/dist /public
EXPOSE 3000
