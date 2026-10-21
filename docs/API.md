# API Reference

Base URL: your deployment origin (e.g. `https://api.billanta.example`). All examples omit it.

## Conventions

- **Envelope.** Every JSON endpoint returns `{ "success": true, "data": … }` on success or
  `{ "success": false, "message": "…", "code"?: "…" }` on failure. The HTTP status carries the
  category (400/401/403/404/409/503/500). Exceptions: `GET /` is plain text and the legal/admin
  pages are HTML.
- **Auth.** Protected endpoints require `Authorization: Bearer <accessToken>`. Template browsing
  uses *optional* auth (works signed-out; a token unlocks premium downloads). The `/admin`
  authoring API uses `Authorization: Bearer <ADMIN_API_KEY>`.
- **Money is strings of paise.** Every monetary field on the wire is an integer number of paise as
  a string (`"531000"` = ₹5,310.00). Quantities and tax rates are decimal strings.
- **Pagination.** List endpoints take `?limit` (1–100, default 20) and `?cursor`, and return
  `{ items, nextCursor, hasMore }`. Pass `nextCursor` back as `?cursor`.
- **Client-generated ids.** Invoices, customers and products accept a client uuid `id`; writes are
  idempotent by `(userId, id)`.

Common errors: `401` (missing/expired token — or `code: "ACCOUNT_NOT_FOUND"` when the token is valid
but its account no longer exists: re-run `POST /auth/google`, not a refresh), `404` (missing or
not-yours), `409` (duplicate id or number), `503` (media when S3 unconfigured).

---

## Health

`GET /` → `200` plain text `Billanta Backend Running`.

## Legal (public HTML)

Three public pages (HOA protocol 12): no auth, `Content-Type: text/html`, self-contained (inline CSS,
no scripts or external assets), light theme, readable on a phone. They are the URLs on the Google
Play listing, and the app opens them from `GET /config` → `links.*` — **never hard-code them**.

| Page | Canonical path (what `/config` hands out) | Aliases |
| --- | --- | --- |
| Privacy Policy | `GET /privacy` | `/privacy-policy` |
| Terms & Conditions | `GET /terms` | `/terms-of-service`, `/terms-and-conditions` |
| Delete your account | `GET /delete-account` | `/account-deletion`, `/data-deletion` |

The delete-account page is Google Play's "Delete account URL": it names the app and the developer
(**Ferbotz**), gives the email route (`support@ferbotz.com`), and states what is deleted (everything,
including uploaded images) and what is kept (web-server records, 14 days). It lists **no in-app
steps** while the app's in-app deletion is hidden (APP-013). Content lives in `src/modules/legal/legal.view.ts`; `npm run check:legal` pins it.

### In the app (HOA protocol 12 §3)

At runtime, always read these from `GET /config` → `links.*`. The values below are what `links.*`
carries today. Use them **only** as the app's compiled-in defaults, so the links work on a first
launch that has never reached `/config`.

| UI item | `links.*` key | Today's value | Where it appears | Opens |
| --- | --- | --- | --- | --- |
| Privacy Policy | `privacyPolicy` | `https://billanta.ferbotz.com/privacy` | Settings · sign-in consent line · premium/upgrade screen | in-app browser tab (Custom Tabs) |
| Terms & Conditions | `terms` | `https://billanta.ferbotz.com/terms` | Settings · sign-in consent line · premium/upgrade screen | in-app browser tab |
| Delete account (web page) | `deleteAccount` | `https://billanta.ferbotz.com/delete-account` | optional today (see below); later, the in-app deletion confirmation screen | in-app browser tab |
| Contact support | `supportEmail` | `support@ferbotz.com` | Settings | `mailto:` |

- **Sign-in:** next to "Sign in with Google", the line *"By continuing you agree to our Terms &
  Conditions and Privacy Policy"*, with both phrases linked.
- **Delete account, today:** in-app deletion is built but hidden (APP-013), and the public page
  offers only the email route. A Settings row labelled "Delete account" that opens
  `links.deleteAccount` is protocol 12's literal form and gives signed-in users a route to find;
  whether to show it meanwhile is the app's call.
- **Delete account, when it ships:** the path is **Profile → Settings → Account → Delete account**:
  a confirmation screen, then `DELETE /users/me`, then local sign-out. Send the `APP-nnn` that
  announces it **before** the build reaches users or Play review, so the public page can list those
  steps the same day. Reviewers follow the page literally. That confirmation copy must not promise
  image removal: `DELETE /users/me` keeps the uploaded images, unlike the email route.

---

## Remote config

### `GET /config`
The behaviour switches the app reads **on every cold start**: feature kill switches, update
policy, maintenance, the caps to respect, the legal links. Changing them needs no app release.

**Nothing about the caller is required** — no token, no headers, no query string. It never touches
the database, so it answers even when Postgres is down. This section is the whole contract for the
app; the backend's design notes and ops runbook live in the backend repo (`docs/REMOTE_CONFIG.md`).

Optional request headers (the targeting inputs — send them on **every** request, not just this
one; a garbled value is treated as absent, never a `400`):

```
X-App-Platform: android        # "android" | "ios" | "web"
X-App-Version: 1.4.2           # display version string
X-App-Build: 1042              # INTEGER build number / versionCode — what version rules compare
X-Device-Id: <install uuid>    # stable per-install id — the experiment-bucketing key
Authorization: Bearer <jwt>    # when signed in — enables per-user overrides
```

```json
// 200 — Cache-Control: no-store
{ "success": true, "data": {
  "schemaVersion": 1,
  "variant": "default",
  "revision": "23e0a1c074d1",
  "ttlSeconds": 3600,
  "config": {
    "features": { "googleLogin": true, "cloudSync": true, "templateStore": true,
                  "premiumTemplates": true, "productCatalogue": true, "mediaUpload": true },
    "update": { "minSupportedBuild": 0, "recommendedBuild": 0, "androidStoreUrl": null,
                "iosStoreUrl": null, "message": null },
    "maintenance": { "enabled": false, "message": null },
    "limits": { "maxMediaBytes": 8388608, "maxSyncBatchInvoices": 500, "maxPageSize": 100,
                "maxValuesBytes": 65536, "maxLineValuesBytes": 8192, "maxLineItems": 500 },
    "links": { "privacyPolicy": "https://billanta.ferbotz.com/privacy",
               "terms": "https://billanta.ferbotz.com/terms",
               "deleteAccount": "https://billanta.ferbotz.com/delete-account",
               "supportEmail": "support@ferbotz.com" }
  }
} }
```

- `schemaVersion` is bumped **only** when a key is removed or renamed — adding one never bumps it.
  `variant` names the targeting rules that applied (`"default"` when none did); `revision` is a
  fingerprint of `config` that changes whenever any value does; `ttlSeconds` is how long the
  client may reuse the document.
- **The client must ignore unknown keys and default missing ones leaf by leaf** — new keys appear
  without an app release. Never default a whole section.
- `update.*Build` are compared against the **integer** build number, never the version string.
  `0` = no requirement, and an unknown build is never blocked.
- `features.*` gate **UI entry points only**; the API routes keep working.
- `limits.*` mirror what the server enforces (`POST /media` 8 MB, ≤ 500 invoices per sync push,
  `?limit` ≤ 100, a record's `values` ≤ 64 KB, a line's ≤ 8 KB, ≤ 500 lines per invoice) — check
  them before calling, don't retype them.
- `links.*` are absolute: use them instead of hard-coding the host.

---

## Forms (public)

### `GET /forms`
The global **business profile, customer, product and settings** forms. The app builds those four
screens entirely from this document, so a new field there needs no app release. Public, no auth (the
forms are needed offline and before sign-in). Sends an `ETag`; repeat with `If-None-Match` → `304`.

```json
// 200 — Cache-Control: public, no-cache
{ "success": true, "data": {
  "schemaVersion": 1,
  "optionLists": { "indian_states": [ { "value": "29", "label": "Karnataka" }, … ] },
  "forms": {
    "company":  { "sections": [ { "id": "business", "label": "Business details", "fields": [ … ] }, … ] },
    "customer": { "sections": [ … ] },
    "product":  { "sections": [ … ] },
    "settings": { "sections": [ … ] }
  }
} }
```

Each field is a fully-resolved field definition. The fields, types, value formats and the rules for
saving them are [`FIELDS.md`](FIELDS.md) — the reference for everything in a `values` map below.

## Values maps — how records are stored

Company, settings, customer, product and invoice data travel as a **`values` map: field id → value**
([`FIELDS.md`](FIELDS.md) §7). The rules shared by every endpoint below:

- Keys are registered field ids whose owner the record accepts. An unknown key is a `400`, never
  silently dropped.
- Values are strings, `true`/`false`, objects (an image `{ "url", "thumbnailUrl" }`, a discount
  `{ "kind", "value", "beforeTax" }`) or `null`. **Numbers are decimal strings** (`"18"`, `"2.5"`);
  money is integer paise as a string (`"150000"`).
- The server checks shape and size only, plus the money inputs (quantity, unit price, tax rate,
  discount, currency) and the state codes, which it calculates with. It **never rejects a format**
  — a GSTIN with a bad checksum is stored as typed.
- `""` and `null` mean empty: dropped on a full replace, "clear this key" on a `PATCH`.
- `POST`/`PUT` replace the whole map; `PATCH` merges (absent key → unchanged, `null` → cleared).

---

## Auth (public)

### `POST /auth/google`
Verifies a Google **idToken** server-side and returns tokens.
```json
// request
{ "idToken": "eyJhbGciOi..." }
// 200
{ "success": true, "data": {
  "accessToken": "eyJ...", "refreshToken": "b3f1…(64 hex)", "expiresIn": 900,
  "user": { "id": "uuid", "email": "a@b.com", "name": "Asha", "photoUrl": null, "isPremium": false }
} }
```
`401` if the idToken is invalid or its `aud` ≠ `GOOGLE_CLIENT_ID`.

### `POST /auth/refresh`
Rotates the refresh token: revokes the presented one and issues a fresh pair. Reusing an
already-revoked token revokes the whole chain (theft response) and returns `401` with
`code: "REFRESH_TOKEN_REUSED"`.
```json
{ "refreshToken": "…" }   // → same shape as /auth/google
```

### `POST /auth/logout`
Revokes the presented refresh token. Always `200` (silent about unknown tokens).
```json
{ "refreshToken": "…" }   // → { "success": true, "data": {} }
```

---

## Users (auth)

- `GET /users/me` → the profile `{ id, email, name, photoUrl, isPremium, createdAt, updatedAt }`.
- `PATCH /users/me` — body `{ "name"?: string, "photoUrl"?: string|null }` (email/googleId are not
  editable). → the updated profile.
- `DELETE /users/me` — permanently deletes the account and all its data (cascades to company,
  customers, products, invoices, settings, refresh tokens). It does **not** remove uploaded images
  (logo, signature, QR, product photos) from storage. → `{ }`.

## Company (auth)

The business profile: `company_*` field id → value ([`FIELDS.md`](FIELDS.md) §3.3, §7.2).

- `GET /company` → `{ "values": { … }, "createdAt", "updatedAt" }`, or `data: null` if not set up.
- `PUT /company { "values": { … } }` — **full replace** (an omitted field is cleared). → the profile.
- `PATCH /company { "values": { … } }` — **merge**: `null` clears a key, an absent key is untouched.
  With no profile yet it creates one — an invoice can write a company field back before the profile
  screen was ever opened. → the profile.

```json
// PUT /company
{ "values": {
  "company_name": "Ferbotz Innovations Private Limited",
  "company_logo": { "url": "https://…/logo.webp", "thumbnailUrl": "https://…/logo_thumb.webp" },
  "company_gstin": "29ABCDE1234F1Z5",
  "company_state": "29",
  "company_address_line1": "1 MG Road",
  "company_city": "Bengaluru",
  "company_bank_name": "HDFC Bank",
  "company_bank_account_number": "50100123456789",
  "company_bank_ifsc": "HDFC0001234",
  "company_upi_id": "ferbotz@okhdfc",
  "company_signature": { "url": "https://…/sign.webp", "thumbnailUrl": "https://…/sign_thumb.webp" },
  "company_signatory_name": "Vishal B"
} }
```

Nothing is required — a profile may be empty. `company_state` must be a code from the
`indian_states` list (it decides CGST+SGST vs IGST); any other key just has to be a `company_*` id.

## Settings (auth)

`settings_*` field id → value — the defaults that pre-fill a new invoice.

- `GET /settings` → `{ "values", "createdAt", "updatedAt" }`. Created on first read with the
  settings form's defaults: `settings_invoice_prefix: "INV-"`, `settings_next_invoice_number: "1"`,
  `settings_default_currency: "INR"`.
- `PUT /settings { "values" }` replaces the whole map — including the running invoice number, so a
  client changing one setting should `PATCH`.
- `PATCH /settings { "values" }` merges.

## Customers (auth)

`customer_*` field id → value. Client-generated ids, idempotent by `(userId, id)`.

```json
// POST /customers  (201) — create, or full replace on a repeated id
{ "id": "uuid?",
  "values": { "customer_name": "Bob Buyer", "customer_phone": "98765…", "customer_gstin": "27…",
              "customer_state": "27", "customer_address_line1": "…", "customer_city": "Pune" } }
// 201 — data
{ "id": "uuid", "values": { … }, "createdAt": "…", "updatedAt": "…" }
```
- `GET /customers?q=&limit=&cursor=` — `q` matches name, phone or GSTIN. → `{ items, nextCursor, hasMore }`.
- `GET /customers/:id` · `PATCH /customers/:id { "values" }` (merge) · `DELETE /customers/:id` (hard
  delete). A foreign/missing id → `404`; a colliding id owned by someone else → `409`.
- An invoice editor that edits a customer field writes it back with `PATCH`; a customer typed into an
  invoice with none picked is created with `POST` ([`FIELDS.md`](FIELDS.md) §8.4).

## Products (auth)

A reusable catalogue of line items. Its values use the **line-item ids** (`description`, `image`,
`hsn_sac`, `unit`, `unit_price`, `tax_rate` — never `quantity`), so picking a product copies its values
straight into a line; editing the line never writes back. **Same shape and rules as Customers**
(client uuid `id`, idempotent by `(userId, id)`; foreign/missing → `404`, a colliding id → `409`).
There is deliberately **no** `/products/sync` and **no** server-side dedup — the client replays per
row and decides what "the same product" is.

```json
// POST /products  (201)
{ "id": "uuid?",
  "values": { "description": "Design hour", "hsn_sac": "998314", "unit": "hour",
              "unit_price": "150000", "tax_rate": "18",
              "image": { "url": "https://billanta-media.s3.ap-south-1.amazonaws.com/media/<userId>/<uuid>.webp",
                         "thumbnailUrl": "https://billanta-media.s3.ap-south-1.amazonaws.com/media/<userId>/<uuid>_thumb.webp" } } }
```
- `GET /products?q=&limit=&cursor=` — `q` matches the description. → `{ items, nextCursor, hasMore }`.
- `GET /products/:id` · `PATCH /products/:id { "values" }` (merge) · `DELETE /products/:id` (**hard**
  delete).
- `unit_price` is paise as a string and `tax_rate` 0–100: both are validated strictly (they're money
  inputs). `updatedAt` is server-stamped (last write to reach the server wins).
- **The photo** is the `{ url, thumbnailUrl }` `POST /media` returned. Each URL must be an absolute
  `https:` URL of at most 1000 characters — a device-local `file://` or `content://` URI is a `400`.
  Any https host is accepted, so a URL the server once returned always replays. **`DELETE` removes the
  row only**: the photo's S3 objects stay (one upload can back several rows, and invoices copy it).

---

## Invoices (auth)

An invoice is its `values` (its own fields **plus a copy of the company and customer values it
prints**), its `lineItems`, and a few top-level fields. Totals are recomputed server-side from the
lines; any totals you send are ignored and the server's are returned so the client can correct itself.

### `POST /invoices` (201) — create or idempotently replace
```json
{
  "id": "uuid?",                            // client-generated; re-POST replaces
  "templateId": "classic", "templateVersion": 2,
  "status": "Draft",                        // Draft | Pending | Paid
  "values": {
    "customer": "6f1c…",                    // the picked customer's id
    "invoice_number": "INV-1", "invoice_date": "2026-07-25", "due_date": "2026-08-09",
    "currency": "INR", "po_number": "PO-7781", "notes": "…",
    "discount": { "kind": "percent", "value": "10", "beforeTax": true },
    "company_name": "Acme", "company_state": "27",
    "customer_name": "Bob", "customer_phone": "98765…", "customer_state": "27"
  },
  "lineItems": [
    { "id": "uuid?", "values": { "description": "Widget", "quantity": "1", "unit_price": "1000", "tax_rate": "18" } },
    { "id": "uuid?", "values": { "description": "Gadget", "quantity": "2", "unit_price": "2000", "tax_rate": "18" } }
  ],
  "themeOverrides": { "accent": "#c2410c" },  // optional: token name -> hex. null/omit = template defaults
  "hiddenSections": ["signature", "terms"],    // optional: section ids to hide. null/omit = template defaults
  "pdfPath": null,                             // optional; omitted = left as stored
  "updatedAt": "2026-07-25T10:00:00.000Z"      // the client's edit time (last-write-wins key)
}
```
- `values` accepts `invoice`-, `company`- and `customer`-owned ids; `line_items` is never a value.
  Line `values` accept the line ids. Line order is array order; a line without an `id` gets one.
- **Money inputs are strict** (a `400`, or a sync conflict): `quantity` a non-negative decimal,
  `unit_price` whole paise, `tax_rate` 0–100, `discount` `{ kind: "flat"|"percent", value, beforeTax? }`
  (a flat value is paise; a percent 0–100), `currency` an ISO code, the two state codes from
  `indian_states`. A **missing** one counts as 0 / no discount / INR / IGST, so an empty draft saves.

Response `data`:
```json
{ "id", "templateId", "templateVersion", "status", "values": { … },
  "lineItems": [ { "id", "values": { … }, "computed": { "line_total": "1000", "tax_amount": "162" } }, … ],
  "computed": { "subtotal": "5000", "discount_total": "500", "tax_total": "810",
                "cgst_total": "405", "sgst_total": "405", "igst_total": "0", "grand_total": "5310" },
  "themeOverrides", "hiddenSections", "pdfPath", "deletedAt", "createdAt", "updatedAt" }
```
- `computed` is in paise strings. Tax splits into CGST + SGST when `company_state` equals
  `customer_state`, otherwise (or when either is missing) into IGST.
- `409` if a non-empty `invoice_number` is already used by another of the user's live invoices
  (an empty number never clashes; deleting an invoice releases its number), or if the id belongs to
  another user.
- `themeOverrides` (object) and `hiddenSections` (array of strings) are stored and echoed back
  **verbatim** — opaque to the server (validated only as object / string-array with a small size cap).

### List / read / patch / delete
- `GET /invoices?limit=&cursor=&status=&q=` — `status` filters (Draft/Pending/Paid); `q` matches the
  invoice number and the customer name/phone. Excludes soft-deleted. → `{ items, nextCursor, hasMore }`.
- `GET /invoices/:id` → the invoice (404 if deleted/foreign/missing).
- `PATCH /invoices/:id` — `{ "status"?, "pdfPath"?, "values"?, "updatedAt"? }`. `values` **merges**
  (`null` clears a key) and the invoice is recomputed, so a patched discount moves the totals. Lines
  change only through a full `POST`. `"status": null` is ignored, never a downgrade. → the invoice.
- `DELETE /invoices/:id` — **soft delete** (tombstone). Idempotent (a repeat returns `200`).
  Accepts an **optional** JSON body `{ "updatedAt": "<ISO-8601>" }` — the client's delete time, which
  becomes the tombstone's `updatedAt` (kept **monotonic**: never set below the row's current value).
  Absent → server `now()`. Send it so a queued/offline delete stays in the same client-clock domain
  as edits and the sync cursor, and orders consistently against edits made on another device.

### `POST /invoices/sync` — batch offline sync
```json
// request
{ "invoices": [ { …same shape as POST /invoices, id REQUIRED… } ], "since": null }
// 200
{ "success": true, "data": {
  "changed": [ …invoices changed since the cursor, incl. tombstones (deletedAt set)… ],
  "conflicts": [ { "id": "uuid", "reason": "…" } ],
  "nextCursor": "opaque-string", "hasMore": false
} }
```
- Pushes are applied **last-write-wins** by `updatedAt` (the client's edit time; send it on each
  invoice). A push older than the server's copy is skipped; a malformed, cross-user, or
  duplicate-number invoice is reported in `conflicts` **without aborting the batch**.
- The pull is **bounded** (≤ 200 rows/page). Store `nextCursor` and pass it back as `since`; if
  `hasMore` is true, sync again immediately to drain the rest. First sync sends `since: null`.

---

## Templates (optional auth)

- `GET /templates?limit=&cursor=` → `{ items: [ { id, name, category, thumbnailUrl, isPremium,
  currentVersion, checksum } ], nextCursor, hasMore }` — active templates, **cursor-paginated** like
  the other lists (premium ones included for upsell). Backward-compatible: a small catalogue returns
  one page with `nextCursor: null`.
  - **`thumbnailUrl`** (APP-012) — a picture of the template, rendered by the server at publish time:
    page 1 of the current version exactly as an **exported** invoice looks (no `editorOnly` nodes), in
    its **default theme**, filled with one fixed, fictional sample invoice (every field populated;
    `INV-0042`, fixed dates) so the thumbnails compare side by side. **WebP, 640 px wide** at the
    page's own aspect ratio (A4 → 640×906), edge to edge, **opaque white** — no alpha, frame or
    shadow. ~20–30 KB.
  - **Public, no auth — premium templates included.** Their compiled JSON stays gated; the picture of
    it doesn't. Served straight from S3 with `Cache-Control: public, max-age=31536000, immutable`.
  - **The URL changes whenever the image does** (the path embeds the version and a hash of the
    bytes; an object is never replaced under the same URL), so caching an image by URL forever is
    correct. Publishing a new version changes it; the old URL keeps serving the old image.
  - It lags only if a render fails: the value then stays on the **previous** version's image (never
    reverting to `null`) until a retry succeeds. `null` only for a template whose versions have never
    rendered one.
  - Rendered by the backend's own renderer from the same compiled tree the app downloads — the same
    version, not pixel-identical to the app's renderer.
- `GET /templates/:id` → full detail incl. `currentVersion`, `checksum`, `isActive`.
- `GET /templates/:id/compiled?version=` → the **Billanta Template JSON** (see
  [`TEMPLATE_JSON.md`](TEMPLATE_JSON.md)) in `data`. Sends an `ETag` (the checksum); repeat with
  `If-None-Match` → `304`. A specific `?version=` is immutable (`Cache-Control: …immutable`); the
  current view revalidates. **Premium templates require `isPremium` (signed in)** → else `403`
  `code: "PREMIUM_REQUIRED"`. Premium responses are `Cache-Control: private`.

## Media (auth)

`POST /media` — `multipart/form-data`, single field **`file`** (an image). Compressed to WebP in two
sizes and uploaded to S3.
```json
// 201
{ "success": true, "data": { "url": "https://…/full.webp", "thumbnailUrl": "https://…/thumb.webp",
  "contentType": "image/webp" } }
```
- **Accepted input:** any `image/*` MIME type. Decoded server-side via sharp; the current build decodes
  **JPEG, PNG, WebP, GIF, TIFF, HEIC/HEIF, SVG**. A safe client-side allow-list is `image/jpeg`,
  `image/png`, `image/webp`, and `image/heic`/`image/heif` (iOS). A non-`image/*` type is a `400`.
- **Size cap:** **8 MB**; a larger file is a `400`. One file per request.
- **Output:** always `contentType: "image/webp"` — a full image (≤1280 px, quality 75) plus a thumbnail
  (≤512 px, quality 60). Both `url` and `thumbnailUrl` are public S3 URLs. The **input** format/size are
  not echoed; the client only gets the two WebP URLs back.

`503` `Media storage is not configured` when S3 env is unset (the rest of the app still works).

---

## Admin (template authoring)

`GET /admin` (panel HTML) and `POST /admin/login` are **public**; everything else requires
`Authorization: Bearer <ADMIN_API_KEY>`.

- `POST /admin/login` — `{ username, password }` checked against `ADMIN_PANEL_USER/PASSWORD`; on
  success returns `{ apiKey }` (the `ADMIN_API_KEY`) for the browser session. `401` on mismatch,
  `503` if panel login isn't configured.
- `GET /admin/templates` · `POST /admin/templates` (`{ id(slug), name, description?, category?,
  thumbnailUrl?, isPremium?, orderIndex? }`, `201`; `409` if the id exists).
- `GET /admin/templates/:id` (→ `{ template, versions[] }`) · `PATCH /admin/templates/:id` ·
  `DELETE /admin/templates/:id`. Each version summary carries `thumbnailUrl`, `thumbnailError` (the
  last failure, `null` once a render succeeds) and `thumbnailAt`. A `thumbnailUrl` set by hand through
  `POST`/`PATCH` is overwritten by the next publish's render.
- `POST /admin/templates/:id/versions` — `{ html, css }` → **compiles** and stores a Draft version
  (`201`, `data` includes the compiled JSON + checksum). On a bad template: `400`
  `code: "TEMPLATE_COMPILE_FAILED"` with the exact located message; nothing is stored.
- `GET /admin/templates/:id/versions/:v` → source + compiled JSON.
- `POST /admin/templates/:id/versions/:v/publish` → makes it the current (immutable) version;
  archives the previous. `409` if it's already current. Then renders the version's picker thumbnail
  (≈1 s) and returns the version summary plus
  `thumbnail: { status: "ok", url, reused } | { status: "failed", error }`. **A thumbnail can never
  fail the publish:** once the publish commits the response is `200`, and a failed render is reported
  in `thumbnail` (and shown in the panel) while `GET /templates` keeps the previous image. A version
  that already has a thumbnail (a rollback, or a draft rendered earlier) reuses it (`reused: true`).
- `POST /admin/templates/:id/versions/:v/thumbnail` → re-renders that version's thumbnail — the retry
  (the panel's Render/Re-render button, and `npm run thumbnails:backfill`). Same response shape. Only
  the **current** version's render changes what `GET /templates` serves.
- `POST /admin/media` — same as `POST /media`, for a manual image upload. (Picker thumbnails no longer
  go through it; they're rendered on publish.)
