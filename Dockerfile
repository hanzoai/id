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

# Publishable event-ingest key (pk-live-…), inlined by Vite into the bundle.
#
# EVENT_INGEST_KEY is the name in KMS (org `hanzo`, path `deploy`, env `prod`)
# and on the --build-arg; the VITE_ prefix is what makes Vite inline it, and it
# is a property of THIS build, so it is applied here and the secret store keeps
# the ONE plain name.
#
# Publishable and write-only by design — it authorizes a write into one org and
# can read nothing — so shipping it in a bundle is the documented use. It is
# still a credential: it comes from KMS via CI. Never commit a value here.
#
# Deliberately NO default. An absent key is not a degraded mode: cloud takes the
# unkeyed beacon down the anonymous lane, files every row under the `$public`
# tenant this org cannot read, and answers 200 — so a keyless build looks
# healthy from the page and reports nothing to the warehouse. hanzo.id ran that
# way with no telemetry at all, which is the failure this build gate exists to
# make loud.
ARG EVENT_INGEST_KEY
ENV VITE_EVENT_INGEST_KEY=$EVENT_INGEST_KEY
# Fail closed, and gate HERE because this is the one path every builder passes
# through — a guard in a workflow protects that lane only.
RUN case "$EVENT_INGEST_KEY" in \
      pk-*) : ;; \
      '')   echo "EVENT_INGEST_KEY is empty - pass --build-arg EVENT_INGEST_KEY=<pk-...> (KMS deploy/EVENT_INGEST_KEY, env prod)" >&2; exit 1 ;; \
      *)    echo "EVENT_INGEST_KEY is not a publishable key (expected a pk- prefix)" >&2; exit 1 ;; \
    esac

# Do NOT re-declare ARG VITE_EVENT_INGEST_KEY below this line. A later ARG of the
# same name shadows the ENV set above with an empty default, so the key resolves,
# passes the gate, and is then blanked before Vite inlines it — every step green,
# the bundle unattributed. That is exactly how hanzo.chat 1.0.58 shipped.
#
# `&&`, not `;`: with `;` the RUN exits with the status of the LAST command and a
# failed build would be masked. Assert on the bytes that actually ship — a key
# present in the environment and absent from the bundle is indistinguishable from
# success everywhere except the warehouse, where the traffic simply stops being
# attributable.
RUN pnpm --filter @hanzo/id-web build && \
    { grep -rqF "$VITE_EVENT_INGEST_KEY" apps/web/dist || \
      { echo "ERROR: the ingest key is not in apps/web/dist - hanzo.id would ship unattributed" >&2; exit 1; }; }

# SPA server stage — hanzoai/spa is the correct base for a Vite SPA:
# history-API fallthrough for client-side routes AND a SPA-safe CSP.
# hanzoai/static defaults to `Content-Security-Policy: default-src 'none'`
# (built for static assets, not an app that loads its own bundle), which
# blocks the SPA's own scripts and leaves a blank page. hanzoai/spa serves
# index.html for all routes with a sane CSP. Defaults: PORT=3000, ROOT=/public.
FROM ghcr.io/hanzoai/spa:1.4.8
COPY --from=build /build/apps/web/dist /public
EXPOSE 3000
