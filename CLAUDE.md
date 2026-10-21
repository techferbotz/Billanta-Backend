# Billanta Backend — Agent & Developer Context

> Orientation file for AI agents and new developers. Read this first.
> Deeper docs live in [`docs/`](docs/): [`API.md`](docs/API.md) (every endpoint),
> [`TEMPLATE_AUTHORING.md`](docs/TEMPLATE_AUTHORING.md) (the HTML/CSS subset for designers),
> [`TEMPLATE_JSON.md`](docs/TEMPLATE_JSON.md) (the render-tree contract the Android app is built
> against), [`FIELDS.md`](docs/FIELDS.md) (field ids, types, forms and values maps — what every
> section, form and record is made of; [`FIELDS_APP_GUIDE.md`](docs/FIELDS_APP_GUIDE.md) is the app's
> build plan for it, against [`docs/examples/`](docs/examples/)), [`MONEY.md`](docs/MONEY.md) (the calculation spec the client mirrors),
> [`REMOTE_CONFIG.md`](docs/REMOTE_CONFIG.md) (the `GET /config` behaviour switches), and
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
4. **Media** — logos, signatures, QR images and product photos to object storage.

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

## Cross-side contract folder (app ↔ backend channel)

Billanta is built across two laptops — this one (Node/TS **backend**) and another (Kotlin
Multiplatform **app**). Cross-side requirements travel through a Google-Drive-synced folder, **not**
by copying files around or opening the other repo.

- **Path (this laptop):** `G:\My Drive\Billanta\Billanta-Contract`
  (app laptop, macOS: `~/Library/CloudStorage/GoogleDrive-techferbotz@gmail.com/My Drive/Billanta/Billanta-Contract`).
- **Read `README.md` there first — it is the authoritative protocol.** In brief: the backend writes
  ONLY inside `backend/`, the app writes ONLY inside `app/`, and each side's `applied.md` is a
  watermark recording how far it has consumed the other's log.
- **To handle app requests:** implement every `app/REQUESTS.md` entry newer than the watermark in
  `backend/applied.md`; update the reference docs in `backend/` (`API.md`, `TEMPLATE_JSON.md`,
  `MONEY.md` — the app is written against *those* files); append a `BE-nnn` entry to
  `backend/CHANGELOG.md` for anything the app must react to; then move `backend/applied.md`.
- **Two hard rules:** never read or clone the app's repository (everything needed is in the folder),
  and never paste implementation code into the folder — describe the *contract*, not how it's built.
- The `backend/` docs there are the curated copy the app builds against; `docs/` in THIS repo is the
  internal copy — keep both honest when the API changes.

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
npm run check:phase3v       # values-map validation for company/settings/customer/product/invoice
npm run check:forms         # field registry + the four global forms (ids, owners, prefixes, defaults)
npm run check:compiler      # template compiler: structure, determinism, exact-location rejects
npm run check:seeds         # every seed template compiles deterministically
npm run check:thumbnails    # picker-thumbnail renderer: layout rules + seed renders to the APP-012 spec
npm run thumbnail:render -- --html t.html --css t.css --out t.png   # preview a thumbnail locally
npm run thumbnails:backfill # render any missing thumbnails via the admin API (needs ADMIN_API_KEY)
npm run docs:examples       # regenerate docs/examples/ (the app's contract fixtures) from the real code
npm run check:money         # invoice calculation fixtures (exact paise)
npm run check:config        # remote config: strict merge, header parsing, resolve order, fail-fast
npm run check:legal         # legal pages: required sections, quoted constants, /config links match
npm run check:phase3        # cross-user isolation           (needs DB + running server)
npm run check:phase4        # template authoring→serving      (needs DB + running server)
npm run check:phase5        # invoice CRUD + recompute + sync (needs DB + running server)
npm run check:products      # product CRUD + photos + isolation (needs DB + running server)
```

No Billanta database on this dev box? The Postgres on `localhost:5432` may belong to another
project, so don't touch it. Instead, spin up a throwaway PG 18 cluster (binaries in
`C:\Program Files\PostgreSQL\18\bin`): `initdb -D <tmp> -U postgres -A trust`, then
`pg_ctl -D <tmp> -o "-p 55432" start`, then `createdb`. Point `DATABASE_URL` + `PORT=3100` at it,
run `prisma migrate deploy`, start the server and run the checks. Stop it and delete `<tmp>` after.

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

Optional: `PORT` (3000), `APP_PUBLIC_URL` (the public origin, default
`https://billanta.ferbotz.com` — absolute links in `GET /config` are built from it; a path or a
malformed value fails startup), `ACCESS_TOKEN_TTL` (15m), `REFRESH_TOKEN_TTL_DAYS` (60),
`REMOTE_CONFIG_OVERRIDES` (a JSON *patch* over the `GET /config` document, applied to every
caller — the no-deploy kill switch; an unknown key or wrong type **fails startup** on purpose),
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
  prisma/serializable.ts        # serializable read-modify-write with retry (values-map PATCH merges)
  types/express.d.ts            # adds req.userId
  fields/                       # SERVER-DRIVEN FIELDS (docs/FIELDS.md) — pure, no Prisma, no HTTP
    registry.ts                 #   every field id + its owner (and the few fixed types); additive only
    types.ts                    #   field types, wire kinds, the resolved FieldDefinition shape
    resolve.ts                  #   authored field definition -> resolved one (shared by forms + compiler)
    forms.ts                    #   the 4 global forms (company/customer/product/settings) + GET /forms doc
    optionLists.ts              #   named select options (indian_states)
    wire.ts / values.ts         #   per-wire-kind checks; values-map parse/merge for every record
  common/
    response/apiResponse.ts     # sendSuccess() + envelope types
    errors/AppError.ts          # AppError (+code) + Bad/Unauthorized/Forbidden/NotFound/Conflict/ServiceUnavailable
    errors/errorHandler.ts      # central error middleware → { success:false, message, code? }; maps P2025→404, P2002→409
    middleware/                 # auth (required + optional), adminAuth (constant-time key), upload (multer), requestLogger
    utils/                      # asyncHandler, jwt (access + refresh helpers), getUserId
    pagination.ts               # cursor pagination { items, nextCursor, hasMore }
    deepMerge.ts                # deepMergeStrict: patch must fit the base's shape, or it throws
    validation.ts               # shared request-shape validators (string/uuid/object body)
    values.ts                   # parseValuesOr400: fields/values.ts at the HTTP edge
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
    render/                     # picker thumbnails (APP-012): compiled tree -> 640px WebP
      layout.ts                 #   pure: tree + data -> element tree (the "dumb renderer" rules)
      rasterize.ts              #   the ONLY importer of satori + @resvg/resvg-js
      sampleInvoice.ts          #   the one fixed, fictional dataset every thumbnail renders with
      renderThumbnail.ts        #   forks thumbnailWorker.ts per render (heap cap + 30s deadline)
  modules/                      # feature modules: routes → controller → service → repository → dto
    auth/ user/ company/ settings/ customer/ product/ invoice/ template/ media/ admin/ legal/
    legal/                      # /privacy /terms /delete-account — HTML rendered from legal.view.ts constants
    remoteConfig/               # GET /config — defaults + env overrides + targeting rules; no DB
    forms/                      # GET /forms — the global forms from src/fields/forms.ts; no DB
  scripts/                      # the check:* verification scripts
assets/fonts/                   # the app's 5 font families (static TTFs + OFL licences), for thumbnails
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
- **Records are values maps, and the backend defines every field** ([`docs/FIELDS.md`](docs/FIELDS.md)).
  Company, customer, product, settings, invoice and line data is a `values` JSON map of field id →
  value; the few typed columns beside it are derived on write (search, uniqueness, totals). A new
  field is a `src/fields/registry.ts` entry (+ its form, for an entity field) — **never a migration
  and never an app release**. Ids are additive only: never rename or re-own one. Templates declare
  each section's fields (`data-fields`) and the compiler rejects any printed path that isn't a listed
  field. The server never rejects a value for its *format* (GSTIN, phone…) — only for its shape and
  size, plus the money inputs it calculates with.
- **The remote config document is additive-only.** `GET /config` is what lets us change app
  behaviour without a release, and it only works because clients ignore keys they don't know and
  default the ones they're missing. Adding a key is free; removing or renaming one breaks old
  builds — bump `SCHEMA_VERSION` and prefer adding. Numbers the server enforces are **imported**
  into the defaults, never retyped. HOA protocol 10; see [`docs/REMOTE_CONFIG.md`](docs/REMOTE_CONFIG.md).
- **The legal pages only claim what the code does** (HOA protocol 12). Every data category,
  processor and retention period in `src/modules/legal/legal.view.ts` was checked against the
  schema, the deletion path and the box. When data handling changes — a new synced field, a new
  processor, media cleanup on account deletion, backups — change the pages **in the same commit**,
  bump the effective date, and run `npm run check:legal`. The app shows them from `GET /config`
  `links.*`, never hard-coded URLs. **SDKs inside the app count too**, even though this repo can't
  see them. Firebase Crashlytics and Cloud Messaging are on the pages because of APP-014, so an APP
  entry that adds or drops an app-side SDK is legal-page work.
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
- **Thumbnails render in a child process, never in the API server.** The prod box has <1 GB RAM
  shared across projects; satori + resvg + parsed fonts peak well over 100 MB, so each render forks
  `thumbnailWorker` and the memory goes back to the OS when it exits. Don't import `rasterize.ts`
  into the server. satori and resvg are **pinned exactly**: a thumbnail's URL embeds a hash of its
  bytes, so an upgrade that moves a pixel re-keys every thumbnail on its next render.
- **Lato and Open Sans have no ₹ glyph** (as distributed by Google Fonts). The renderer always loads
  Roboto — Android's system font — as the fallback, which mirrors how a phone draws it.
- **A thumbnail must never fail a publish** (APP-012 §5). `templateThumbnail.service` never throws;
  failures are recorded on the version and shown in the admin panel with a retry.

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
7. **Remote config** — `GET /config`: the behaviour switches the app reads at launch (feature kill
   switches, update policy, maintenance, mirrored limits, legal links), resolved from defaults +
   `REMOTE_CONFIG_OVERRIDES` + an (empty) targeting-rule registry. Pure, synchronous, no DB.
8. **Legal pages to protocol 12** — privacy / terms / delete-account rewritten against the real
   codebase (developer Ferbotz, support@ferbotz.com, laws of India), light theme, `APP_PUBLIC_URL`
   as the one origin for `/config` links, and `check:legal` pinning the pages to their constants.
9. **Picker thumbnails (APP-012 / BE-016)** — every publish renders page 1 of the version from its
   compiled tree with a fixed sample invoice (satori + resvg in a sandboxed child process), stores a
   640px WebP in S3 under a content-hashed key, and serves it as `thumbnailUrl`. Per-version
   thumbnail fields, a retry endpoint + panel button, and `check:thumbnails`.
10. **Server-driven fields (BE-021, 2026-10-21)** — a clean break while the app had no users: the
   field registry + four global forms (`GET /forms`), templates declaring each section's fields
   (compiler v2: flat field-id bindings, hideable columns/rows, `edits` gone), every record stored as
   a `values` map (migration `server_driven_fields` discards the old rows), device-only `remember`,
   and `check:forms`. Spec: [`docs/FIELDS.md`](docs/FIELDS.md).
