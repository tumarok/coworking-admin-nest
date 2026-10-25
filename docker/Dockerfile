# Two images from one file:
#   docker build -f docker/Dockerfile -t coworking-admin-nest .                    the API (default)
#   docker build -f docker/Dockerfile --target migrate -t coworking-admin-nest-migrate .
# The migration image carries the Prisma CLI (about 250 MB with its studio and embedded database),
# which the API does not need, so the two are kept apart.
FROM node:24-alpine AS base
WORKDIR /app
ENV NPM_CONFIG_AUDIT=false NPM_CONFIG_FUND=false NPM_CONFIG_UPDATE_NOTIFIER=false

# Production dependencies, the Prisma CLI included.
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts

# The same without the CLI: the API only needs the generated client and its driver.
FROM prod-deps AS api-deps
RUN npm pkg delete dependencies.prisma && npm prune --omit=dev --ignore-scripts
# The client ships a query compiler for every database and source maps; only PostgreSQL is used.
RUN find node_modules/@prisma/client/runtime \( -name '*.map' -o -name 'query_compiler_*_bg.*' ! -name '*postgresql*' \) -delete

# Every dependency, to compile the sources and generate the Prisma client.
FROM base AS build
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts
COPY prisma.config.ts tsconfig.json tsconfig.build.json nest-cli.json ./
COPY prisma prisma
COPY src src
RUN npx prisma generate && npm run build

# Applies the migrations, then seeds an empty database: `docker run <image>`.
FROM base AS migrate
ENV NODE_ENV=production
COPY package.json prisma.config.ts ./
COPY --from=prod-deps /app/node_modules node_modules
# `--ignore-scripts` skipped the download of the schema engine, which the CLI would otherwise
# attempt at run time into a directory the unprivileged user cannot write.
RUN npm rebuild @prisma/engines
COPY --from=build /app/dist dist
COPY prisma prisma
USER node
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/database/seed/cli.js"]

FROM base AS runtime
ENV NODE_ENV=production PORT=4010
COPY package.json ./
COPY --from=api-deps /app/node_modules node_modules
COPY --from=build /app/dist dist
USER node
EXPOSE 4010
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=10 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT ?? 4010) + '/health').then((r) => process.exit(Number(!r.ok)), () => process.exit(1))"]
CMD ["node", "dist/main.js"]
