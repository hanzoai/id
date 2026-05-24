FROM node:22-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# --- Dependencies ---
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# --- Build ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build args become env vars at build time (for white-label forks)
ARG NEXT_PUBLIC_IAM_URL
ARG NEXT_PUBLIC_ORG
ARG NEXT_PUBLIC_CLIENT_ID
ARG NEXT_PUBLIC_APP_NAME

ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm build

# --- Production ---
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Runtime env vars for white-label configuration:
#   IAM_ORIGIN          — IAM backend URL (default: https://iam.hanzo.ai)
#   NEXT_PUBLIC_IAM_URL — Same, for client-side
#   NEXT_PUBLIC_ORG     — Organization name (default: hanzo)
#   NEXT_PUBLIC_CLIENT_ID — Default app client ID

CMD ["node", "server.js"]
