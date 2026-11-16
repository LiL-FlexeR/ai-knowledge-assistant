# syntax=docker/dockerfile:1
FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS dependencies
WORKDIR /app
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates
RUN npm install --global pnpm@12.21.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,id=aka-pnpm,target=/pnpm/store pnpm install --frozen-lockfile --store-dir /pnpm/store

FROM dependencies AS build
COPY tsconfig.base.json ./
COPY scripts scripts
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm db:generate && pnpm --filter @aka/shared build && pnpm --filter @aka/api build
RUN --mount=type=cache,id=aka-pnpm,target=/pnpm/store pnpm --filter @aka/api deploy --prod --legacy --store-dir /pnpm/store /out/api

# Explicit CLI operation, never part of API startup. Includes dev-only Prisma CLI.
FROM build AS migration
USER node
CMD ["pnpm", "db:migrate"]

FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out/api ./
RUN mkdir -p /data/documents && chown node:node /data/documents
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
