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
- **Client-generated ids.** Invoices and customers accept a client uuid `id`; writes are
  idempotent by `(userId, id)`.

Common errors: `401` (missing/expired token), `404` (missing or not-yours), `409` (duplicate id or
number), `503` (media when S3 unconfigured).

---

## Health

`GET /` → `200` plain text `Billanta Backend Running`.

## Legal (public HTML)

`GET /privacy` · `/terms` · `/delete-account` (plus aliases `/privacy-policy`,
`/terms-of-service`, `/terms-and-conditions`, `/account-deletion`, `/data-deletion`).

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
  customers, invoices, settings, refresh tokens). → `{ }`.

## Company (auth)

- `GET /company` → the company object, or `data: null` if not set up yet.
- `PUT /company` — **full replace**; `name` required, all other fields optional (omitting one
  clears it). A valid `gstin` derives/validates `stateCode`. → the saved company.

## Settings (auth)

- `GET /settings` → the user's settings (auto-created with defaults on first call).
- `PUT /settings` — **merge** (only sent fields change): `defaultCurrency`, `defaultTaxPercent`
  (string, 0–100), `invoiceNumberPrefix`, `nextInvoiceNumber` (int ≥ 1), `defaultTemplateId`,
  `defaultNotes`. → the updated settings.

## Customers (auth)

```json
// POST /customers  (201) — client may supply "id" (uuid); idempotent by (userId,id)
{ "id": "uuid?", "name": "Bob Buyer", "phone": "98765…", "email": "…", "gstin": "27…",
  "addressLine1": "…", "city": "…", "state": "…", "stateCode": "27", "pincode": "…", "country": "India" }
```
- `GET /customers?q=&limit=&cursor=` — `q` matches name/phone. → `{ items, nextCursor, hasMore }`.
- `GET /customers/:id` · `PATCH /customers/:id` (partial) · `DELETE /customers/:id` (hard delete).
  A foreign/missing id → `404`; a colliding id owned by someone else → `409`.

---

## Invoices (auth)

Money fields are recomputed server-side from `items`; any totals you send are ignored and the
server's values are returned so the client can correct itself.

### `POST /invoices` (201) — create or idempotently replace
```json
{
  "id": "uuid?",                          // client-generated; re-POST replaces
  "invoiceNumber": "INV-1", "invoiceDate": "2026-07-25T00:00:00Z", "dueDate": null,
  "currency": "INR", "status": "Draft",   // Draft | Pending | Paid
  "templateId": "classic", "templateVersion": 1,
  "customerId": "uuid?",
  "customerSnapshot": { "name": "Bob", "stateCode": "27", ... },   // ≤ 8KB JSON
  "companySnapshot":  { "name": "Acme", "stateCode": "27", ... },
  "notes": "…",
  "discountType": "Percentage",           // Flat | Percentage | (omit for none)
  "discountValue": "10",                   // percent, or paise for Flat
  "discountBeforeTax": true,
  "items": [
    { "description": "Widget", "quantity": "1", "unitPrice": "1000", "taxRatePercent": "18" },
    { "description": "Gadget", "quantity": "2", "unitPrice": "2000", "taxRatePercent": "18" }
  ]
}
```
Response `data` echoes the invoice with **server-computed** `subtotal`, `discountTotal`, `taxTotal`,
`grandTotal` (paise strings), per-item `taxAmount`/`lineTotal`, and a derived
`gstSplit: { intraState, cgst, sgst, igst }`. `409` if the `invoiceNumber` is already used or the id
belongs to another user.

### List / read / patch / delete
- `GET /invoices?limit=&cursor=&status=&q=` — `status` filters (Draft/Pending/Paid); `q` matches
  invoice number and the snapshot customer name/phone. Excludes soft-deleted. →
  `{ items, nextCursor, hasMore }`.
- `GET /invoices/:id` → the invoice (404 if deleted/foreign/missing).
- `PATCH /invoices/:id` — quick scalar edits only: `status`, `notes`, `dueDate`, `pdfPath`,
  `invoiceDate`, `invoiceNumber`, `currency`. (To change items/discount, re-POST the whole
  invoice.) → the updated invoice.
- `DELETE /invoices/:id` — **soft delete** (tombstone). Idempotent (a repeat returns `200`).

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

- `GET /templates` → `{ items: [ { id, name, category, thumbnailUrl, isPremium, currentVersion,
  checksum } ] }` (active templates; premium ones included for upsell).
- `GET /templates/:id` → full detail incl. `currentVersion`, `checksum`, `isActive`.
- `GET /templates/:id/compiled?version=` → the **Billanta Template JSON** (see
  [`TEMPLATE_JSON.md`](TEMPLATE_JSON.md)) in `data`. Sends an `ETag` (the checksum); repeat with
  `If-None-Match` → `304`. A specific `?version=` is immutable (`Cache-Control: …immutable`); the
  current view revalidates. **Premium templates require `isPremium` (signed in)** → else `403`
  `code: "PREMIUM_REQUIRED"`. Premium responses are `Cache-Control: private`.

## Media (auth)

`POST /media` — `multipart/form-data` field **`file`** (an image). Compressed to WebP in two sizes
and uploaded to S3.
```json
// 201
{ "success": true, "data": { "url": "https://…/full.webp", "thumbnailUrl": "https://…/thumb.webp",
  "contentType": "image/webp" } }
```
`503` `Media storage is not configured` when S3 env is unset (the rest of the app still works).
`400` for a non-image or an oversized (> 8 MB) file.

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
  `DELETE /admin/templates/:id`.
- `POST /admin/templates/:id/versions` — `{ html, css }` → **compiles** and stores a Draft version
  (`201`, `data` includes the compiled JSON + checksum). On a bad template: `400`
  `code: "TEMPLATE_COMPILE_FAILED"` with the exact located message; nothing is stored.
- `GET /admin/templates/:id/versions/:v` → source + compiled JSON.
- `POST /admin/templates/:id/versions/:v/publish` → makes it the current (immutable) version;
  archives the previous. `409` if it's already current.
- `POST /admin/media` — same as `POST /media`, for template thumbnails.
