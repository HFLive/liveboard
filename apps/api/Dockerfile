FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    --mount=type=cache,id=prisma,target=/root/.cache/prisma \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /root/.cache/node/corepack /root/.cache/node/corepack
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    --mount=type=cache,id=prisma,target=/root/.cache/prisma \
    pnpm config set store-dir /pnpm/store \
    && node apps/api/node_modules/prisma/build/index.js generate --schema apps/api/prisma/schema.prisma \
    && node node_modules/typescript/bin/tsc -p packages/shared/tsconfig.json \
    && cd apps/api \
    && node node_modules/@nestjs/cli/bin/nest.js build \
    && cd /app \
    && pnpm --filter @liveboard/api deploy --prod --legacy --trust-lockfile --ignore-scripts /prod/api \
    && node /prod/api/node_modules/prisma/build/index.js generate --schema /prod/api/prisma/schema.prisma

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node --from=builder /prod/api apps/api
WORKDIR /app/apps/api
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
