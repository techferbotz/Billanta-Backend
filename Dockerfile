# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Billanta backend — multi-stage build.
#
#   builder : install ALL deps, generate the Prisma client, compile TS -> dist/
#   runner  : production deps only + compiled app + generated Prisma client
#
# The build needs NO secrets: neither `tsc` nor `prisma generate` connects to the
# database. DATABASE_URL / JWT_SECRET / GOOGLE_CLIENT_ID / ADMIN_API_KEY are supplied
# at RUNTIME (via .env / compose env_file), where src/config/env.ts validates them.
#
# The `builder` stage is also what runs migrations in production — the Prisma CLI is a
# dev dependency and is deliberately absent from the slim runtime image. See the
# `migrate` service in docker-compose.prod.yml.
# ---------------------------------------------------------------------------

# ----------------------------- Builder -------------------------------------
FROM node:22-slim AS builder

# Prisma's query engine needs OpenSSL to be generated.
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (this layer is cached unless package*.json changes).
COPY package*.json ./
RUN npm ci

# Generate the Prisma client BEFORE compiling — tsc imports its generated types
# (model types, enums, Prisma.PrismaClientKnownRequestError). Without this, the build fails.
COPY prisma ./prisma
RUN npx prisma generate

# Compile TypeScript -> dist/
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ----------------------------- Runner --------------------------------------
FROM node:22-slim AS runner

# The Prisma query engine needs OpenSSL at runtime too.
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

# Production dependencies only — no dev toolchain in the final image.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The compiled app, the generated Prisma client + engine, and the schema/migrations.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma

# Drop root privileges — the official image ships a non-root `node` user.
USER node

EXPOSE 3000

CMD ["node", "dist/app.js"]
