# syntax=docker/dockerfile:1
# ---- build stage ----
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# ---- runtime stage ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist ./dist
# Committed migration SQL — needed at runtime by `node dist/db/migrate.js`
# (`make migrate-booking` runs it inside the network, since booking-db has no host
# port per ADR-0001). drizzle-orm's migrator applies it; drizzle-kit is not needed here.
COPY drizzle ./drizzle
ENV PORT=8081
EXPOSE 8081
# Healthcheck uses node's global fetch — no curl/wget needed in the image.
CMD ["node", "dist/server.js"]
