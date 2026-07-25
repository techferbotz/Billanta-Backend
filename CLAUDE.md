# Billanta Backend — Agent & Developer Context

> Orientation file for AI agents and new developers. Read this first.
> Deeper docs live in [`docs/`](docs/): [`API.md`](docs/API.md) (every endpoint),
> [`TEMPLATE_AUTHORING.md`](docs/TEMPLATE_AUTHORING.md) (the HTML/CSS subset for designers),
> [`TEMPLATE_JSON.md`](docs/TEMPLATE_JSON.md) (the render-tree contract the Android app is built
> against), [`MONEY.md`](docs/MONEY.md) (the calculation spec the client mirrors), and
> [`DEPLOY.md`](docs/DEPLOY.md) (the EC2 runbook).

## What this is

Billanta is a **mobile-first invoice generator for Android**. Its promise: create and share a
professional invoice in **under 30 seconds**. It is NOT an accounting app — no inventory, ledgers,
GST filing or payment gateways.

The Android app is **offline-first**: invoice creation, template rendering, PDF generation and
search all work with **no network**. Login is **optional** and only unlocks cloud features.

The backend therefore has exactly four jobs:

1. **Template pipeline** — designers author templates in HTML+CSS; the backend validates and
   **compiles** them into "Billanta Template JSON" and serves versioned, immutable compiled trees.
2. **Auth** — Google Sign-In, with short-lived access tokens + rotating refresh tokens.
3. **Cloud sync** — invoices, customers, company profile and settings for signed-in users.
4. **Media** — logos, signatures and QR images to object storage.

### The one architectural rule everything hangs on

The mobile app **never renders HTML and never uses a WebView**. HTML+CSS is an **authoring
language only**. The pipeline is:

```
Designer → HTML + CSS → Backend Compiler → Billanta Template JSON → Mobile Renderer → Preview + PDF
```

One renderer produces both preview and PDF, so they are always pixel-identical. The compiler's job
is to emit a render tree so simple and fully-resolved (cascade applied, inheritance flattened, units
in points, bindings extracted) that the client renderer is "dumb". See
[`docs/TEMPLATE_JSON.md`](docs/TEMPLATE_JSON.md).

## Tech stack

| Concern | Choice |
| --- | --- |
| Language | TypeScript (`strict`, CommonJS, target ES2020, `src` → `dist`) |
| Runtime | Node.js 22 (`node:22-slim` in Docker) |
| HTTP | Express 5 |
| Database | PostgreSQL 16 |
| ORM | Prisma **6** (pinned — see gotchas) |
| Auth | `jsonwebtoken` (access) + opaque refresh tokens + `google-auth-library` (verify idToken) |
| Object storage | AWS S3 (`@aws-sdk/client-s3`) |
| Images | `sharp` (WebP, two sizes) |
| Uploads | `multer` (memory storage) |
| HTML parse | `parse5` · CSS parse: `postcss` |
| Money | `decimal.js` (exact decimal; never floats) |

Built with plain `tsc` — no bundler, no framework CLI. There is no test framework; the standing
safety net is `npx tsc --noEmit` plus the `check:*` scripts (see below).

## Build & run commands

```bash
npm run dev                 # ts-node-dev, hot reload (src/app.ts)
npm run build               # tsc -> dist/
npm start                   # node dist/app.js (after build)
npm run typecheck           # tsc --noEmit — the primary safety net; run after every change
npm run prisma:generate     # regenerate the Prisma client after editing schema.prisma
npm run prisma:migrate      # create/apply a dev migration (needs a running Postgres)
npm run prisma:migrate:deploy  # apply committed migrations (prod)
npm run seed:templates      # publish the starter templates (needs DB + migrations applied)

# Verification scripts (no DB needed unless noted):
npm run check:auth          # refresh-token rotation + theft detection (in-memory)
npm run check:phase3v       # company/settings/customer validation
npm run check:compiler      # template compiler: structure, determinism, exact-location rejects
npm run check:seeds         # every seed template compiles deterministically
npm run check:money         # invoice calculation fixtures (exact paise)
npm run check:phase3        # cross-user isolation           (needs DB + running server)
npm run check:phase4        # template authoring→serving      (needs DB + running server)
npm run check:phase5        # invoice CRUD + recompute + sync (needs DB + running server)
```

A local Postgres for dev: `docker compose up -d db` (Postgres 16 on `localhost:5432`,
`billanta`/`billanta`/`billanta`). Then `npm run prisma:migrate:deploy` and `npm run dev`.
Without a DB you can still typecheck, build, boot the server (Prisma connects lazily), and run the
no-DB `check:*` scripts.

## Environment variables (`.env` — see `.env.example`)

Required (the app **fails fast on startup** if any are missing — `src/config/env.ts`):

- `DATABASE_URL` — Postgres connection string
- `JWT_SECRET` — signs the short-lived access token
- `GOOGLE_CLIENT_ID` — every Google idToken is verified and its `aud` must equal this
- `ADMIN_API_KEY` — bearer key for the `/admin` authoring API

Optional: `PORT` (3000), `ACCESS_TOKEN_TTL` (15m), `REFRESH_TOKEN_TTL_DAYS` (60),
`S3_BUCKET` + `AWS_REGION` + `S3_PUBLIC_BASE_URL` (media; unset ⇒ `POST /media` returns 503 and
everything else works), `ADMIN_PANEL_USER` + `ADMIN_PANEL_PASSWORD` (the `/admin` panel login).
**Nothing reads `process.env` except `config`; never hardcode a secret.**

## Directory map

```
prisma/schema.prisma            # all models; grows one build phase at a time
prisma/migrations/              # committed SQL migrations (a discrete step; never run on boot)
src/
  app.ts                        # express bootstrap: middleware → health → legal → routes → 404 → errorHandler
  config/env.ts                 # loads + validates env, exports typed `config` (only reader of process.env)
  prisma/client.ts              # singleton PrismaClient
  types/express.d.ts            # adds req.userId
  common/
    response/apiResponse.ts     # sendSuccess() + envelope types
    errors/AppError.ts          # AppError (+code) + Bad/Unauthorized/Forbidden/NotFound/Conflict/ServiceUnavailable
    errors/errorHandler.ts      # central error middleware → { success:false, message, code? }; maps P2025→404, P2002→409
    middleware/                 # auth (required + optional), adminAuth (constant-time key), upload (multer), requestLogger
    utils/                      # asyncHandler, jwt (access + refresh helpers), getUserId
    pagination.ts               # cursor pagination { items, nextCursor, hasMore }
    validation.ts               # shared input validators (string/number/currency/uuid/decimal/…)
    gstin.ts                    # GSTIN checksum + state-code reconciliation
    money.ts                    # THE calculation module (see docs/MONEY.md). Pure; decimal.js; never floats
  auth/googleVerifier.ts        # the ONLY importer of google-auth-library
  storage/
    s3Storage.ts                # the ONLY importer of @aws-sdk/client-s3; disabled-when-unconfigured
    imageCompressor.ts          # the ONLY importer of sharp; WebP full ≤1280/q75 + thumb ≤512/q60
  templates/                    # THE CORE SUBSYSTEM — the compiler
    html/parser.ts              # parse5 → whitelisted tree, depth-bounded, located errors
    css/{parser,cascade,properties,units,colors}.ts   # postcss → cascade → resolved absolute styles
    compile/{nodes,bindings,errors,compiler}.ts       # node types, {{binding}} extraction, CompileError, orchestrator
    seed/seedTemplates.ts       # 3 starter templates (also the authoring examples)
  modules/                      # feature modules: routes → controller → service → repository → dto
    auth/ user/ company/ settings/ customer/ invoice/ template/ media/ admin/ legal/
  scripts/                      # the check:* verification scripts
docker-compose.yml              # dev (includes postgres:16)
docker-compose.prod.yml         # prod (NO postgres; host DB via host.docker.internal; migrate under profile "tools")
Dockerfile                      # multi-stage builder + runner (non-root)
```

## Conventions (follow these for new code)

- **Layering, strictly:** `route → middleware → controller → service → repository → Prisma`.
  Controllers are thin (read input, validate shape, call a service, respond). Services hold
  business rules. **ALL Prisma calls live in repositories** — no exceptions. Each external SDK
  sits behind exactly one file (`s3Storage`, `imageCompressor`, `googleVerifier`).
- **Response envelope, always.** Success: `{ success: true, data }` via `sendSuccess`. Failure:
  `{ success: false, message, code? }` — throw a typed `AppError` subclass; never
  `res.status().json()` an error by hand. One central `errorHandler` produces every failure.
- **Config fails fast.** Missing required env → throw at startup.
- **Ownership is by `userId`, always.** Every invoice/customer/company/settings query is scoped to
  the authenticated user. A foreign or missing resource returns **404, never 403**, so existence
  isn't leaked. A client-supplied id never alone grants access.
- **Offline-first:** invoices and customers carry **client-generated uuids**; writes are
  **idempotent by (userId, id)**. Syncable rows carry `updatedAt` (client-controlled) and a
  soft-delete `deletedAt` tombstone.
- **Money is never a float.** Integer paise in `BigInt` columns, serialized as **strings**; all
  arithmetic goes through `src/common/money.ts` (decimal.js, half-up). See [`docs/MONEY.md`](docs/MONEY.md).
- **Published template versions are immutable.** Editing publishes a NEW version — which is what
  lets clients cache a compiled tree by `(templateId, version)` forever.

## Gotchas / constraints

- **Prisma is pinned to v6 on purpose.** v7 removes `url = env("DATABASE_URL")` and requires a
  `prisma.config.ts` + driver adapter. `prisma generate` prints a "v7 available" nudge — ignore it;
  don't `npm update` Prisma.
- **Migrations are a discrete step; they NEVER run on container start.** In prod, run the `migrate`
  service explicitly. **GOTCHA:** `docker compose run --rm migrate` happily runs a STALE image and
  reports "no pending migrations" — always `run --rm --build migrate`, and rebuild the app too so
  its regenerated Prisma client matches. See [`docs/DEPLOY.md`](docs/DEPLOY.md).
- **The compiler is the security boundary.** The client trusts the compiled tree completely, so the
  compiler rejects everything outside the HTML/CSS subset, blocks external resource URLs (including
  a fallback on an `<img>` binding), rejects prototype-polluting binding paths (`__proto__`,
  `constructor`, `prototype`), bounds `colspan` and nesting depth, and is deterministic
  (byte-identical output + sha256). Renderers **must ignore unknown node types and style keys**.
- **`updatedAt` on Invoice is client-controlled** (not Prisma-managed) — it is the last-write-wins
  key and the `/invoices/sync` pull cursor. The pull cursor is a `(updatedAt, id)` keyset, opaque
  to the client; server wall-clock is never mixed into it.
- **Windows dev:** `ts-node-dev` can hold the Prisma query-engine DLL; if `prisma generate` fails
  with `EPERM`, stop stray `ts-node-dev` node processes first.

## Build history (phases)

1. **Skeleton** — TS + Express 5 + config + Prisma client + error handler + envelope + health + Docker.
2. **Auth** — verified Google idToken, 15m access JWT, rotating 60d refresh tokens (hashed, theft
   detection), `authMiddleware`/`optionalAuth`, `/users/me`.
3. **Company, Settings, Customers, Media** — userId-scoped CRUD (404 on foreign), GSTIN validation,
   customer client-uuid idempotency, S3 media with a 503 fallback.
4. **Template compiler** — the core subsystem: parse5 + postcss → cascade/resolve/normalize →
   Billanta Template JSON; `Template`/`TemplateVersion` (immutable published), public + admin APIs,
   the self-contained admin panel, seed templates.
5. **Invoices** — the money module (BigInt paise, decimal.js, half-up, togglable discount timing),
   `Invoice`/`InvoiceItem`, server-recompute CRUD + search, and `/invoices/sync` (LWW + tombstones).
6. **Legal pages + docs** — public privacy/terms/delete-account pages; this docs set.
