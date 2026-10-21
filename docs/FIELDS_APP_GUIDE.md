# Server-driven fields: app implementation guide (BE-021)

This is the build plan for the app side of BE-021. **[`FIELDS.md`](FIELDS.md) is the normative
contract**; this guide turns it into steps, settles the edge cases, and points at
[`examples/`](examples/), whose files are generated from the backend's real code
(`npm run docs:examples`). Where this guide and FIELDS.md disagree, FIELDS.md wins, and please raise
an `APP-nnn`.

> **Status.** The backend is implemented and tested but **not deployed**. Production still serves the
> old contract until the deploy wipes it and publishes v2 templates; BE-022 will say when it's live.
> Build and unit-test against `examples/` meanwhile. The old `edits` and dotted-path code paths don't
> need to keep working: there are no users to migrate.

## Contents

0. What to remove
1. What to fetch and cache
2. The local data model
3. Rendering an invoice
4. The invoice editor
5. A new invoice: starting values
6. Remembered values
7. Write-back, freezing and template switching
8. The four entity screens
9. Talking to the API
10. Edge cases
11. Acceptance checklist

---

## 0. What to remove

The app can delete the following outright. Nothing on the server needs them any more.

| Remove | Replaced by |
| --- | --- |
| The per-`edits` editors: invoiceDetails, customer, items, discount, notes, bankDetails, signature | One generic **section editor** built from `sections[].fields` (§4) |
| Hard-coded business profile, customer, product and settings screens | **Form screens** built from `GET /forms` (§8) |
| The binding-namespace builder (`company.*`, `customer.*`, `invoice.*`, `items[]`, `payment.*`, `signature.*`) and the REST↔binding renames (`logoUrl` → `company.logo`, …) | The flat **render context** (§3.1) |
| `companySnapshot` / `customerSnapshot`, and the typed Company/Customer/Product/Settings/Invoice models | **Values maps** (§2) |
| The old local database | Start empty. The backend is wiped on deploy, and there are no users. |

## 1. What to fetch and cache

| Document | Endpoint | Cache | Refresh |
| --- | --- | --- | --- |
| Remote config | `GET /config` | As today, plus the new `limits.maxValuesBytes`, `maxLineValuesBytes` and `maxLineItems` | Every cold start |
| Forms | `GET /forms` | Persist the whole document and its `ETag` | Every cold start with `If-None-Match`; `304` means keep the cached copy |
| Template list | `GET /templates` | As today | As today |
| Compiled template | `GET /templates/:id/compiled?version=N` | Forever, by `(id, version)` | Never (versions are immutable) |
| Business profile | `GET /company` | One local record | On sign-in and on sync |
| Settings | `GET /settings` | One local record | On sign-in and on sync |
| Customers, products | `GET /customers`, `GET /products` (paged) | Local tables | As today |
| Invoices | `POST /invoices/sync` | Local table | As today |

**Ship a copy of [`examples/forms.json`](examples/forms.json) in the app bundle.** A first launch can
be offline and signed out, and the business profile screen needs a form. Use the bundled copy until
the first successful `GET /forms`.

## 2. The local data model

Every record is a **values map** (field id → value) plus a few fixed fields:

| Record | Fixed fields | Values |
| --- | --- | --- |
| Business profile (one) | `updatedAt` | `company_*` |
| Settings (one) | `updatedAt` | `settings_*` |
| Customer | `id` (uuid), `updatedAt` | `customer_*` |
| Product | `id` (uuid), `updatedAt` | the line ids, without `quantity` |
| Invoice | `id`, `status`, `templateId`, `templateVersion`, `hiddenSections`, `themeOverrides`, `pdfPath`, `updatedAt`, `deletedAt`, and the cached `computed` totals | `invoice` ids, plus a **complete copy** of the `company_*` and `customer_*` values |
| Invoice line | `id` (uuid), position, cached `computed` (`line_total`, `tax_amount`) | the line ids |
| **Remembered values** (device only) | — | field id → value (§6) |

Store each map as an opaque JSON blob. Don't give field ids their own columns: the list grows from
the backend without an app release. Keep a few derived columns for your own search and sort if you
want them (customer name, invoice number).

**Value encodings** (FIELDS.md §4.3):

| Type(s) | Stored as | Example |
| --- | --- | --- |
| text, multiline, phone, email, gstin, pan, ifsc, upi_id, pincode, hsn_sac, invoice_number, select | string | `"INV-42"`, `"29"` |
| number | decimal string | `"2.5"` (never a JSON number) |
| money | integer paise string | `"150000"` = ₹1,500.00 |
| boolean | `true` / `false` | |
| date, due_date | `"YYYY-MM-DD"` | `"2026-11-05"` |
| image, signature | `{ "url", "thumbnailUrl" }` from `POST /media` | |
| currency_code | ISO 4217 | `"INR"` |
| customer | the customer's uuid | |
| discount | `{ "kind": "flat" \| "percent", "value", "beforeTax" }` (a flat value is paise) | |
| computed, info | not stored | |

**Empty means absent:** clearing a field **removes its key** (§4.5 of FIELDS.md). Never store `""`,
`{}` or placeholders.

## 3. Rendering an invoice

### 3.1 Build the render context

1. If the invoice is a **Draft**, refresh its company and customer copy first (§7.2).
2. `ctx` = a copy of `invoice.values`.
3. `ctx.line_items` = the lines in order, each `{ ...line.values, line_total, tax_amount }`.
4. Add the computed totals: `subtotal`, `discount_total`, `tax_total`, `cgst_total`, `sgst_total`,
   `igst_total`, `grand_total`.
   - Calculate them with [`MONEY.md`](MONEY.md), reading the money inputs from the values (MONEY.md's
     inputs table; a missing input counts as 0, no discount or IGST).
   - The GST split is CGST + SGST when `company_state` equals `customer_state`, otherwise IGST.
   - Once synced, the server's `computed` replaces yours. It must match exactly; if it doesn't, the
     money implementation has a bug.

[`examples/render-context.json`](examples/render-context.json) is a complete context.
[`examples/template-classic.compiled.json`](examples/template-classic.compiled.json) drawn with it
should look like [`examples/template-classic.thumbnail.png`](examples/template-classic.thumbnail.png),
which is the server's own render. Expect the same layout and values, not identical pixels.

### 3.2 Resolve a binding

- Split the `path` on `.` and walk the context. Inside a `repeat` (or a table body repeat), the
  alias (`item`) is bound to the current line map, so `item.line_total` reads that line.
- **Images:** an `<img>` binds `company_logo.url`. Draw nothing when it resolves empty.
- **Selects print their label.** When a bound value belongs to a `select` field, print the option's
  `label`, not its `value`: `company_state` = `"29"` prints "Karnataka".
  - Find the field's definition in the template's `sections`: a top-level field by id, a line column
    by column id inside the `line_items` field's `columns`.
  - Its `options` is either an inline list or a name in `/forms` `optionLists`.
- **Formats:** `currency` formats paise in the invoice's `currency` (default `INR`). `date` formats
  `"YYYY-MM-DD"`. `number` prints a decimal string.
- An empty value prints the binding's `fallback`.

### 3.3 Conditions

`conditional`, `negate`, and every `visibleIf` use one truthiness rule:
- **Falsy:** absent, `null`, `false`, `""`, a decimal string equal to zero (`"0"`, `"0.00"`), an empty
  array, an empty object.
- **Truthy:** everything else.

So `data-if="discount_total"` hides a zero discount, and `data-unless="line_items"` shows an empty
state when there are no lines.

### 3.4 Tables (new in v2)

1. **Columns.** Evaluate each `columns[i].visibleIf` against the context (not a line). For a hidden
   column:
   - drop its cell from every row;
   - shrink a cell whose `colSpan` covers hidden columns by that many;
   - drop a cell whose whole span is hidden;
   - lay out the remaining columns as if the hidden one never existed, giving its width back.
2. **Rows.** A header, footer or static body row with a `visibleIf` that's off is left out. The repeat
   row never has one.
3. Everything else is as before (TEMPLATE_JSON.md).

### 3.5 Sections, editor-only nodes and themes

- **Hidden sections:** skip every node whose `section` is in `invoice.hiddenSections`, but only if that
  section's `hidable` is `true`. A section may be tagged on several nodes, at any depth.
- **`editorOnly` nodes:** draw them only in the editor, never in an export.
- **`themeOverrides`:** as before.
- **Unknown node types and style keys:** ignore them.

## 4. The invoice editor

### 4.1 Structure

- The editor's section list is `sections[]`, **in array order**: each entry's `label`, and its
  `fields` in order.
- Tapping the page opens the section of the **innermost** tagged node under the tap.
- A section with no fields (static text, for example) opens nothing.
- Only offer the show/hide toggle when `hidable` is true. A `customisation` control of type `section`
  drives the same toggle.

### 4.2 One widget per field type

| type | Widget | Notes |
| --- | --- | --- |
| text, multiline | Text input | Honour `maxLength`, `placeholder`, `help`. |
| number | Numeric input | Clamp to `min`/`max`; round to `decimals` places. Store a decimal string. |
| money | Rupee amount input | Show rupees; store paise, an integer string. |
| boolean | Switch | |
| date | Date picker | |
| select | Dropdown or chips | `options` inline, or `/forms` `optionLists[name]`. Store the `value`. |
| image | Gallery or camera, then `POST /media` | Store `{ url, thumbnailUrl }`. |
| signature | Draw pad or upload, then `POST /media` | Store `{ url, thumbnailUrl }`. |
| phone, email, gstin, pan, ifsc, upi_id, pincode, hsn_sac | Text input with the right keyboard | **May warn** on a bad format (GSTIN checksum, email shape…); **never blocks** saving or sharing. |
| invoice_number | Text input, prefilled (§5) | |
| due_date | Chips for `presets` (days after the `relativeTo` field), plus "pick a date" | Store the date. Remember the gap (§6). |
| currency_code | Currency picker | |
| customer | Saved-customer picker, plus "new customer" | Sets `values.customer`; see §7.1. |
| line_items | The line list (§4.3) | |
| discount | Flat / percent toggle, a value, and a before/after-tax switch | A flat value is paise; a percent is 0–100. |
| computed | Read-only text | Show the context value, formatted by `format`. |
| info | Static text | Show `text`, with `label` as a heading if non-empty. |

- **An unknown `type`:** use `fallbackType` if it's one you know; otherwise hide the input. **Keep its
  value either way** — it still prints, and it still syncs.
- **Unknown attributes:** ignore them.
- **`visibleIf`:** show the input only while the field at `path` is truthy (falsy with `negate`),
  re-evaluated as the user types. Hiding an input never clears its value.

### 4.3 The line-item editor

- **Columns:** the `line_items` field's `columns` are the line form. Computed columns (`line_total`,
  `tax_amount`) are read-only.
- **"Add from product":** creates a line and copies **all** of the product's values into it, not just
  the listed columns. Then apply starting values (§5) to columns the product didn't set; `quantity`,
  for example, gets its `default`.
- **Editing a line never changes the product.**
- **Reordering** changes `position`. Send lines in display order.

### 4.4 Validation

- Nothing is required: let a draft be incomplete, and never block save, share or export.
- **Money inputs must never send a value the server rejects:**
  - `quantity`: non-negative decimal;
  - `unit_price`: whole paise;
  - `tax_rate`: 0–100;
  - `discount`: a percent 0–100, a flat value in whole paise;
  - `currency`: a 3-letter code;
  - `company_state` / `customer_state`: a value from `indian_states`.
  
  Constrain the inputs instead of showing errors.

### 4.5 Where a typed value goes (by `owner`)

| owner | On every change |
| --- | --- |
| `invoice` | `invoice.values[id]` |
| `company` | `invoice.values[id]` **and** write back to the profile (§7.1) |
| `customer` | `invoice.values[id]` **and** write back to the customer (§7.1) |
| `line` | `line.values[id]` |
| `computed`, `line_computed` | Never stored |
| Unknown | Treat as `invoice` |

Also update the remembered value when the field has `remember: true` (§6).

## 5. A new invoice: starting values

1. **Create the invoice:**
   - a new `id`, `status: "Draft"`, `updatedAt = now`;
   - the chosen template (the last one used on this device is a good default);
   - `values = {}`, `lines = []`.
2. **Company copy:** copy **every** value of the business profile into `values`.
3. **Currency:** set `values.currency` from `settings_default_currency` (else `"INR"`), even when the
   template doesn't list `currency`. Money formatting needs it.
4. **Invoice number:**
   - `values.invoice_number = settings_invoice_prefix + N`.
   - N is the larger of `settings_next_invoice_number` and one more than the highest number already
     used with that prefix on this device.
   - Then set `settings_next_invoice_number` to N + 1, locally and with `PATCH /settings`.
5. **Every other field the template lists**, in every section (skip `company`, `customer` and
   `computed` owners). The field starts with the first of these that applies:
   1. The **remembered value**, if `remember` is true and one is stored that fits the field's type
      (§6).
   2. The **`default`**:
      - `{kind: "value"}` → its `value`;
      - `{kind: "today"}` → today's date;
      - `{kind: "setting", id}` → that settings value, if set.
      
      For a `due_date`, both the value and the setting are a **number of days**: the date is the
      `relativeTo` field's date plus that many days.
   3. Otherwise **empty** (no key).
6. **Customer fields** stay empty until a customer is picked (§7.1).
7. **A new line:** apply step 5 to each column, after any product values are copied.

"Fits the field's type" means the stored value has the same kind as the field's encoding (§2): a
string for text-like fields, a decimal string for number, `true`/`false` for boolean, and so on. A
remembered value that doesn't fit is ignored.

## 6. Remembered values (device only)

- **Store:** one key-value store per device, keyed by **field id**. Line columns use their own ids,
  which never collide with invoice ids. **Never sync it.**
- **Write it** every time the user changes a `remember: true` field. Clearing the field deletes the
  remembered value.
- **What's stored:** the value itself, except for `due_date`. There it's the gap in **days** between
  the due date and the `relativeTo` date; if that date is empty, store nothing.
- **Sharing across templates:** the same id is remembered across templates. Two templates may give an
  id different types, which is why a value that doesn't fit is ignored (§5).
- **Not remembered:**
  - company and customer fields (they live on their records);
  - `invoice_number` (it comes from settings);
  - `customer`, `line_items`, computed and info fields.
  
  The backend never sends `remember: true` on these.

## 7. Write-back, freezing and template switching

### 7.1 Write-back

**Company field edited in an invoice:**
- update `invoice.values[id]` and the local profile;
- queue `PATCH /company { "values": { id: value } }`, with `null` to clear;
- the PATCH creates the profile if there's none yet.

**Customer picked:**
- set `values.customer = <customer id>`;
- **replace** every `customer_*` key in the invoice with that customer's values, removing the keys
  the customer doesn't have.

**Customer field edited:**
- **With a picked customer:** update the invoice, update the local customer, and queue
  `PATCH /customers/:id { "values": { id: value } }`.
- **With none picked:** create a customer with a new uuid holding the invoice's `customer_*` values
  (`POST /customers`), set `values.customer`, and from then on use the rule above. Do it on the first
  customer-field edit, or at the latest when the invoice is saved.

**Products never receive write-back.**

**Signed out:** apply write-back locally and push it when the user signs in, as with any offline
change.

### 7.2 Drafts follow, issued invoices freeze

- **While `status` is `Draft`:** every time the invoice is opened or rendered, replace its
  `company_*` keys with the current profile's values, and its `customer_*` keys with the picked
  customer's current values (removing keys they no longer have).
- **Once the status is `Pending` or `Paid`:** stop refreshing. The copy changes only when the user
  edits a company or customer field **in that invoice**, and that edit still writes back (§7.1).
- **Back to `Draft`:** refreshing resumes.

### 7.3 Switching template

- **Keep every value.** A field the new template doesn't list stays in `values`, unprinted, and comes
  back if the user switches again.
- **Fields the new template lists that are still absent** get their starting values (§5, step 5).
- **`hiddenSections`:** ids that don't exist in the new template are harmless; keep or drop them.

## 8. The four entity screens

Each screen is one form from `GET /forms`: `forms.company`, `forms.customer`, `forms.product`,
`forms.settings`. Draw `sections` in order, with the same widgets as §4.2.

| Screen | Read | Save |
| --- | --- | --- |
| Business profile | `GET /company` (`null` = not set up) | `PATCH /company` with the changed keys (prefer this to `PUT`, which replaces the whole map) |
| Customer list / detail | `GET /customers?q=` (name, phone or GSTIN) | `POST /customers { id, values }` to create or replace; `PATCH` for edits |
| Product list / detail | `GET /products?q=` (the description) | `POST /products { id, values }`; `PATCH` for edits |
| Settings | `GET /settings` (created with defaults) | `PATCH /settings` with the changed keys |

- **New records:** apply each field's `default` (for example `company_country` = `"India"`).
  `{kind: "setting"}` defaults read the settings values; the product form's `tax_rate` defaults to
  `settings_default_tax_rate`.
- **Fields:** the forms never send `remember`. A form field's `visibleIf` points at a field on the same
  form.
- **Signed out:** the screens work on local records.

[`examples/records.json`](examples/records.json) has a request and the exact response for each of
these.

## 9. Talking to the API

- **Requests and responses:** [`examples/invoice.json`](examples/invoice.json) is a full
  `POST /invoices` request and the exact response it produces. It has 44 values (the complete company
  and customer copy), 4 lines, a hidden section and a theme override. The request's `values` must
  never contain `line_items`.
- **Totals:** take the server's `computed` and each line's `computed` as authoritative.
- **Sync:** `POST /invoices/sync` keeps its mechanics: last-write-wins by `updatedAt`, tombstones, the
  cursor. Each invoice is the `POST /invoices` shape. Chunk pushes under both
  `limits.maxSyncBatchInvoices` and the **2 MB request body cap**, since invoices are bigger now.
- **Errors:**
  - **A `400` on a values map** is an app bug: an unregistered id, a wrong owner, or a malformed money
    input. Log it.
  - **In sync**, the same problems come back as `conflicts` entries.
  - **A `409` on an invoice number:** another live invoice already uses it. Offer to renumber.
- **Images:** `POST /media` → `{ url, thumbnailUrl }` → store as the value. Cache images by URL
  forever. A URL never changes content, and old invoices keep pointing at old images.
- **Limits:** check `limits.maxValuesBytes` (64 KB per map), `maxLineValuesBytes` (8 KB per line) and
  `maxLineItems` (500) before sending.

## 10. Edge cases

| Situation | Do this |
| --- | --- |
| The template lists a company field the profile doesn't have | It's empty. Editing it creates the profile key through `PATCH /company`. |
| Settings never fetched (offline first launch) | Use the settings form's defaults from `/forms`. |
| A remembered value doesn't fit the field's type | Ignore it, and use the `default`. |
| A field type you don't know | `fallbackType`, or hide it — and keep its value. |
| `owner` you don't know | Treat it as `invoice`. |
| A select value not among the options | Print the raw value. |
| `due_date` with an empty `relativeTo` date | Presets are disabled; the date picker still works. |
| An invoice issued on another device, pulled by sync | It's frozen. Render its copy as is. |
| A template version you haven't cached, offline | Render with the last cached version of that template, and fetch the right one when online. |

## 11. Acceptance checklist

The app is done with BE-021 when:

- [ ] `examples/template-classic.compiled.json` drawn with `examples/render-context.json` matches
      `examples/template-classic.thumbnail.png` in layout and values: "Karnataka" not "29", and a
      discount row present.
- [ ] Setting `hide_gst_column: true` hides a GST column in a template that has one, and footer
      spans shrink. Setting `discount_total: "0"` hides the discount row.
- [ ] The Classic editor shows 7 sections in this order: Invoice details, Your business, Bill to,
      Items, Total, Payment details, Notes. Each shows exactly its listed fields.
- [ ] The business profile, customer, product and settings screens are built only from
      `examples/forms.json`. Adding a field to that file shows up without code changes.
- [ ] A new Classic invoice gets the profile copy, the next number from settings, today's date, the
      remembered due gap (or `settings_default_due_days` the first time), and
      `settings_default_notes`. Any other `remember: true` field a template lists comes back with
      its last value.
- [ ] Editing `company_bank_ifsc` inside an invoice updates the profile. Editing a customer field
      updates the customer, or creates one if none was picked.
- [ ] Changing the profile changes a Draft but not a Pending invoice.
- [ ] Your totals for `examples/invoice.json`'s request equal its response's `computed`, to the paise.
- [ ] Remembered values never leave the device: nothing in any request carries them, except as an
      ordinary field value of an invoice.
- [ ] An unknown field type with a `fallbackType` renders as that type; without one, it's hidden and
      its value survives a save and a sync.
