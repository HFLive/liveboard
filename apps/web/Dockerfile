FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /root/.cache/node/corepack /root/.cache/node/corepack
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS=false
ENV NODE_ENV=production
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS=${NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS}
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && node node_modules/typescript/bin/tsc -p packages/shared/tsconfig.json \
    && node apps/web/node_modules/next/dist/bin/next build apps/web \
    && pnpm --filter @liveboard/web deploy --prod --legacy --trust-lockfile --ignore-scripts /prod/web

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node --from=builder /prod/web apps/web
COPY --chown=node:node --from=builder /app/apps/web/.next apps/web/.next
WORKDIR /app/apps/web
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
