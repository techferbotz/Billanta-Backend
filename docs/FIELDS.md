# Server-driven fields: contract spec

> **Status: live since 2026-10-22 (BE-021, deployed per BE-022).** This is the reference for field
> ids, types, forms and values. [`TEMPLATE_JSON.md`](TEMPLATE_JSON.md),
> [`TEMPLATE_AUTHORING.md`](TEMPLATE_AUTHORING.md) and [`API.md`](API.md) cover the same contract from
> the renderer's, the designer's and the endpoint's side. The code is `src/fields/` (registry, types,
> forms, resolver, values) plus the compiler.
>
> **Building the app side?** Start with [`FIELDS_APP_GUIDE.md`](FIELDS_APP_GUIDE.md), the step-by-step
> plan, and [`examples/`](examples/): the forms document, a compiled v2 template with its render
> context and reference thumbnail, record request/response pairs, and an invoice round trip, all
> generated from the backend's code (`npm run docs:examples`).

This is a **clean break**: the app has no real users yet, so nothing here is backward compatible.
It replaces section `edits`, the dotted binding namespace (`invoice.*`, `company.*`, `payment.*`,
`signature.*`, `items[]`), and the fixed REST shapes of `/company`, `/settings`, `/customers`,
`/products` and `/invoices`.

## 1. What was decided

| Topic | Decision |
| --- | --- |
| Section contents | Each **template** lists the fields inside each of its sections. |
| Field ids | Flat `snake_case`, predefined in a backend list. The id is also the template binding: `{{ invoice_number }}`. A new id is added to the backend list first, so later templates can reuse it. |
| `type` and `remember` | Set **per template** on each field, not by the backend list. |
| Remembered values | Kept **on the device only**, not synced. They prefill the next invoice. |
| Business profile, customer, product, settings | **Global forms** served by the backend (`GET /forms`), using the same section and field shape as templates. Their records sync. |
| Editing a company or customer field inside an invoice | Also updates the saved business profile or customer. |
| Editing a line item | Does **not** update the saved product. Picking a product only copies its values. |
| A customer typed into an invoice | Becomes a saved customer. |
| Drafts and issued invoices | A **Draft** follows the live profile and customer. Once issued (no longer Draft), its copy is frozen. |
| Invoice sync | Complete: every field value, plus the company and customer values as they were when issued. A new device shows identical invoices. |
| Required fields | **None.** Drafts can be incomplete and nothing blocks saving or sharing. There is no `required` attribute. |
| Images | An uploaded image is never deleted while any invoice points to it. |
| Existing data | Production is wiped: all accounts, records, templates and uploaded media. |

## 2. Concepts

- **Field id**: a stable name for one piece of data, such as `invoice_number` or `company_gstin`. It
  is used as the storage key, the editor key and the template binding all at once.
- **Owner**: where a field's value is saved (the business profile, a customer, the invoice, and so
  on). It is fixed per id by the backend list (§3.2).
- **Field definition**: how one field is edited: `{ id, type, label, remember, … }` (§4).
- **Section**: a titled group of field definitions. Templates have sections, and so do forms.
- **Form**: the backend's global definition of the business profile, customer, product or settings
  screen (§5).
- **Values map**: what a record stores, as field id → value (§7).
- **Remembered value**: the last value a user entered for a `remember: true` field, kept on the
  device as the starting value for the next invoice (§8.3).
- **Render context**: the flat map of values a template is drawn with (§8.1).

## 3. Field ids

### 3.1 Naming

- Pattern: `^[a-z][a-z0-9_]*$`, at most 64 characters.
- The prefix names the owner: `company_*`, `customer_*`, `settings_*`. Line-item ids have no prefix
  (`quantity`). Invoice ids use plain names (`po_number`).
- Ids are **additive only**. An id is never renamed, never reused for something else, and never
  changes owner. If a meaning changes, add a new id.

### 3.2 Owners

| Owner | Value is saved on | Template may list it | `remember` allowed |
| --- | --- | --- | --- |
| `company` | The business profile (one per user) | yes; edits write back to the profile | no |
| `customer` | The customer picked on the invoice | yes; edits write back to that customer | no |
| `invoice` | The invoice only | yes | yes |
| `line` | One line item (products use the same ids) | only as a `line_items` column | yes |
| `settings` | The user's settings | no; templates use settings only as defaults (§4.4) | — |
| `computed` | Nowhere: the app calculates it | yes, as a read-only `computed` field | — |
| `line_computed` | Nowhere: calculated per line | only as a `line_items` column | — |

### 3.3 The starting list (v1)

"Form type" is the type the global form gives the id. A template field that leaves out `type` (or
`label`) inherits it from here.

**Company** (`company`)

| id | form type | label |
| --- | --- | --- |
| `company_name` | text | Business name |
| `company_logo` | image | Logo |
| `company_gstin` | gstin | GSTIN |
| `company_pan` | pan | PAN |
| `company_address_line1` | text | Address line 1 |
| `company_address_line2` | text | Address line 2 |
| `company_city` | text | City |
| `company_state` | select (`indian_states`) | State |
| `company_pincode` | pincode | PIN code |
| `company_country` | text | Country (default `India`) |
| `company_phone` | phone | Phone |
| `company_email` | email | Email |
| `company_website` | text | Website |
| `company_bank_name` | text | Bank name |
| `company_bank_account_name` | text | Account name |
| `company_bank_account_number` | text | Account number |
| `company_bank_ifsc` | ifsc | IFSC |
| `company_bank_branch` | text | Branch |
| `company_upi_id` | upi_id | UPI ID |
| `company_upi_qr` | image | UPI QR code |
| `company_signature` | signature | Signature |
| `company_signatory_name` | text | Signatory name |
| `company_signatory_designation` | text | Designation |

**Customer** (`customer`)

| id | form type | label |
| --- | --- | --- |
| `customer_name` | text | Customer name |
| `customer_contact_person` | text | Contact person |
| `customer_phone` | phone | Phone |
| `customer_email` | email | Email |
| `customer_gstin` | gstin | GSTIN |
| `customer_address_line1` | text | Address line 1 |
| `customer_address_line2` | text | Address line 2 |
| `customer_city` | text | City |
| `customer_state` | select (`indian_states`) | State (also the place of supply) |
| `customer_pincode` | pincode | PIN code |
| `customer_country` | text | Country (default `India`) |

**Line item / product** (`line`). The product form uses these same ids, which is how picking a
product fills a line.

| id | form type | label | notes |
| --- | --- | --- | --- |
| `description` | text | Product name | |
| `image` | image | Photo | |
| `hsn_sac` | hsn_sac | HSN/SAC | |
| `unit` | text | Unit | e.g. pcs, kg, hour |
| `unit_price` | money | Rate | **money input** (§7.7) |
| `tax_rate` | number (0–100) | GST % | **money input** |
| `quantity` | — (not on the product form) | — | **money input**; a template must give it a type, normally `number` |

**Line computed** (`line_computed`): `line_total` (quantity × rate) and `tax_amount`.

**Invoice** (`invoice`)

| id | expected type | meaning |
| --- | --- | --- |
| `customer` | customer | Which saved customer is billed. Its value is the customer's id. |
| `invoice_number` | invoice_number | e.g. `INV-42` |
| `invoice_date` | date | |
| `due_date` | due_date | |
| `currency` | currency_code | **money input** |
| `po_number` | text | Purchase order number |
| `line_items` | line_items | The lines (§7.6) |
| `discount` | discount | **money input** |
| `notes` | multiline | |
| `terms` | multiline | Terms and conditions |
| `hide_gst_column` | boolean | Display switch for templates with a GST column |

**Computed** (`computed`): `subtotal`, `discount_total`, `tax_total`, `cgst_total`, `sgst_total`,
`igst_total`, `grand_total`. All are paise strings. Splitting GST into CGST and SGST (same state)
or IGST (different states) uses `company_state` and `customer_state`.

**Settings** (`settings`)

| id | form type | label | default |
| --- | --- | --- | --- |
| `settings_invoice_prefix` | text | Invoice number prefix | `INV-` |
| `settings_next_invoice_number` | number | Next invoice number | `1` |
| `settings_default_currency` | currency_code | Default currency | `INR` |
| `settings_default_tax_rate` | number (0–100) | Default GST % | — |
| `settings_default_due_days` | number | Default due in (days) | — |
| `settings_default_notes` | multiline | Default notes | — |
| `settings_default_terms` | multiline | Default terms | — |

### 3.4 Adding an id

A template that needs a new id gets it added to the backend list in code (`src/fields/registry.ts`,
plus the matching form in `src/fields/forms.ts` for a company/customer/product/settings id). This is a
backend deploy, not an app release. The compiler rejects any id that isn't on the list, so a typo
fails at publish instead of printing blank. `npm run check:forms` checks the list: snake_case, the
owner's prefix, and every company/customer/product/settings id present on its form.

### 3.5 Ids with a fixed type

A few ids have a type no template can change, because the server reads their value or because the
value has a special shape. A template may leave the type out (it's implied) or repeat it:

| id | type |
| --- | --- |
| `quantity`, `tax_rate` | number |
| `unit_price` | money |
| `currency` | currency_code |
| `discount`, `line_items`, `customer`, `invoice_number` | the type of the same name |
| `invoice_date` | date |
| `due_date` | due_date or date |
| `company_state`, `customer_state` | select, always with the `indian_states` options |
| the computed ids | computed |

For any other company, customer or product id, a template may change the type only to one stored the
same way (for example `gstin` to `text`, never `image` to `text`).

## 4. Field definitions

### 4.1 Shape

```json
{
  "id": "po_number",
  "owner": "invoice",
  "type": "text",
  "label": "PO number",
  "placeholder": "e.g. PO-7781",
  "help": "Shown under the input",
  "default": { "kind": "value", "value": "" },
  "remember": true,
  "visibleIf": { "path": "show_po", "negate": false },
  "fallbackType": "text"
}
```

`owner` is always filled in by the backend; authors never write it. Every definition the app
receives, in a compiled template or in `/forms`, is **fully resolved**, with any inherited `type`,
`label` and `options` already filled in.

### 4.2 Attributes on every field

| Attribute | Required | Meaning |
| --- | --- | --- |
| `id` | yes (except `info`) | A registered field id. |
| `owner` | always present | Set by the backend (§3.2). |
| `type` | always present | One of §4.3. |
| `label` | always present | What the input is called. |
| `placeholder`, `help` | no | Input hint, and a line of help under it. |
| `default` | no | The starting value when nothing is remembered (§4.4). |
| `remember` | no, default `false` | Keep the last entered value on the device and prefill it next time (§8.3). Only for `invoice` and `line` owners. |
| `visibleIf` | no | Show this input only when another field is truthy, or falsy with `negate: true` (§6.2 truthiness). An editor rule only; it doesn't affect printing. |
| `fallbackType` | no | What to draw if the app doesn't know `type` (§4.6). |

### 4.3 Types

How each type is entered, what goes on the wire, and what `remember` keeps:

| type | Input | Value on the wire | Type-specific attributes | `remember` keeps |
| --- | --- | --- | --- | --- |
| `text` | Single line | string | `maxLength` | The value |
| `multiline` | Text area | string | `maxLength` | The value |
| `number` | Numeric keyboard | decimal string `"2.5"` | `min`, `max`, `decimals` | The value |
| `money` | Amount in rupees | integer **paise** string `"150000"` | — | The value |
| `boolean` | Switch | `true` / `false` | — | The value |
| `date` | Date picker | `"YYYY-MM-DD"` | — | The value |
| `select` | Dropdown or chips | the chosen option's `value` | `options` | The value |
| `image` | Gallery or camera, uploaded with `POST /media` | `{ "url", "thumbnailUrl" }` | — | The value |
| `signature` | Draw pad or upload, via `POST /media` | `{ "url", "thumbnailUrl" }` | — | The value |
| `phone`, `email`, `gstin`, `pan`, `ifsc`, `upi_id`, `pincode`, `hsn_sac` | Text with a matching keyboard; the app may warn on a bad format but never blocks | string | — | The value |
| `invoice_number` | Text, prefilled | string | — | Not remembered: comes from settings (§8.2) |
| `due_date` | Presets ("15 days") or a picked date | `"YYYY-MM-DD"` | `relativeTo` (default `invoice_date`), `presets` (days, e.g. `[0, 7, 15, 30]`) | The **gap in days**, not the date |
| `currency_code` | Currency picker | ISO 4217, `"INR"` | — | The value |
| `customer` | Saved-customer picker, or a new one | the customer's id (uuid) | — | — (the saved customers are the memory) |
| `line_items` | The line editor | see §7.6 | `columns`: field definitions for each line | — (the products are the memory) |
| `discount` | Flat or percent, before or after tax | `{ "kind": "flat" \| "percent", "value": "<decimal>", "beforeTax": true }`; a flat `value` is paise | — | The value |
| `computed` | Read-only display | not stored | `format`: `currency` (default), `number`, `text` | — |
| `info` | A line of static text | not stored | `text` (an info field has no `id`, and its `label` may be `""`) | — |

Option lists:
- `options` is either an inline array `[{ "value": "net15", "label": "Net 15" }]` or the name of a
  list from `/forms` `optionLists` (v1 ships `indian_states`, whose values are the 2-digit GST state
  codes such as `"29"`, labelled `"Karnataka"`).
- A `select` **prints its option's label**, not its value.

Restrictions:
- `customer`, `line_items`, `discount`, `invoice_number` and `due_date` may only be used on the id
  of the same name.
- `computed` may only be used on `computed` or `line_computed` ids.

### 4.4 Defaults

`default` takes one of these forms:

```json
{ "kind": "value", "value": "1" }
{ "kind": "today" }
{ "kind": "setting", "id": "settings_default_notes" }
```

- **`value`** is a literal in the type's wire format.
- **`today`** is the device's current date.
- **`setting`** reads a `settings_*` value.

An unknown `kind` is ignored, as if there were no default.

For `due_date`, the default (and the remembered value) is a **number of days** counted from
`relativeTo`. So `{ "kind": "setting", "id": "settings_default_due_days" }` means "due that many days
after the invoice date".

### 4.5 Clearing a value

Clearing a field **removes its key** from the values map (or sets it to `null`; both mean "empty").
The app never leaves placeholders such as `""` image URLs or `{}` objects behind.

### 4.6 Forward compatibility

- **Unknown `type`:** draw `fallbackType` if one is given and known. Otherwise **hide the input**.
  The value is still kept and printed.
- **Unknown attribute:** ignored.
- **Unknown `default.kind`:** ignored.
- **Unknown `owner`:** treated as `invoice`.
- Never crash on any of these. This is the same rule as unknown template node types, and it lets the
  backend ship a new type before every app build understands it.

## 5. `GET /forms`

Public, no auth. It is cached offline like `/config` and sends an `ETag` (`If-None-Match` → `304`).

```json
{
  "schemaVersion": 1,
  "optionLists": {
    "indian_states": [ { "value": "29", "label": "Karnataka" }, … ]
  },
  "forms": {
    "company": {
      "sections": [
        { "id": "business", "label": "Business details", "fields": [
          { "id": "company_name",  "owner": "company", "type": "text",  "label": "Business name" },
          { "id": "company_logo",  "owner": "company", "type": "image", "label": "Logo" },
          { "id": "company_gstin", "owner": "company", "type": "gstin", "label": "GSTIN" },
          …
        ] },
        { "id": "address",   "label": "Address",      "fields": [ … ] },
        { "id": "bank",      "label": "Bank details", "fields": [ … ] },
        { "id": "upi",       "label": "UPI",          "fields": [ … ] },
        { "id": "signature", "label": "Signature",    "fields": [ … ] }
      ]
    },
    "customer": { "sections": [ … ] },
    "product":  { "sections": [ … ] },
    "settings": { "sections": [ … ] }
  }
}
```

- The four forms contain the ids in §3.3: company, customer, line (minus `quantity`) and settings
  respectively. The full JSON is generated from code and is not retyped here.
- Form sections have no `hidable`.
- The app builds the business profile, customer, product and settings screens entirely from this
  document. A new field there is a backend deploy, not an app release.

## 6. Templates

### 6.1 Compiled document

`schemaVersion` and `compilerVersion` both become **2**. `page`, `theme`, `customisation` and
`root` keep their current shape. `sections` changes to:

```json
"sections": [
  {
    "id": "header",
    "label": "Invoice details",
    "hidable": false,
    "fields": [
      { "id": "invoice_number", "owner": "invoice", "type": "invoice_number", "label": "Invoice no." },
      { "id": "invoice_date",   "owner": "invoice", "type": "date",           "label": "Date",
        "default": { "kind": "today" } },
      { "id": "due_date",       "owner": "invoice", "type": "due_date",       "label": "Due date",
        "remember": true, "relativeTo": "invoice_date", "presets": [0, 7, 15, 30],
        "default": { "kind": "setting", "id": "settings_default_due_days" } },
      { "id": "po_number",      "owner": "invoice", "type": "text",           "label": "PO number",
        "remember": true }
    ]
  },
  {
    "id": "items",
    "label": "Items",
    "hidable": false,
    "fields": [
      { "id": "line_items", "owner": "invoice", "type": "line_items", "label": "Items",
        "columns": [
          { "id": "description", "owner": "line", "type": "text",   "label": "Item" },
          { "id": "hsn_sac",     "owner": "line", "type": "hsn_sac", "label": "HSN/SAC" },
          { "id": "quantity",    "owner": "line", "type": "number", "label": "Qty",
            "default": { "kind": "value", "value": "1" } },
          { "id": "unit_price",  "owner": "line", "type": "money",  "label": "Rate" },
          { "id": "tax_rate",    "owner": "line", "type": "number", "label": "GST %", "min": 0, "max": 100,
            "default": { "kind": "setting", "id": "settings_default_tax_rate" } },
          { "id": "line_total",  "owner": "line_computed", "type": "computed", "label": "Amount" }
        ] },
      { "id": "hide_gst_column", "owner": "invoice", "type": "boolean", "label": "Hide GST column",
        "remember": true }
    ]
  }
]
```

- **Section `id`s** are chosen by the template (`snake_case`, unique in the template). They are what
  `hiddenSections` and `customisation` refer to.
- **`label`** is the template's own.
- **`hidable`** defaults to `true` unless the template says otherwise.
- **Array order is the editor's order.**
- **`edits` is gone.** The fields are the definition.
- Nodes are still tagged with `"section": "<id>"`. A section may be tagged on several nodes, and at
  any depth.
- A field appears in **at most one** section. Its value can still be printed anywhere on the page.

### 6.2 Bindings and conditions

What a template can print or test:

| Path | Resolves to |
| --- | --- |
| `<id>` | A listed field's value, or a computed id |
| `<id>.url`, `<id>.thumbnailUrl` | Part of an `image` or `signature` value |
| `item.<id>` | Inside `data-repeat="line_items as item"`: a listed column, or `line_total` / `tax_amount` |

- **Repeats:** `data-repeat` only iterates `line_items` in v1.
- **Format hints** are unchanged (`text`, `currency`, `date`, `number`). Use `currency` for `money`
  and money `computed` values.
- **Select values print their label.**
- **Truthiness** (`data-if`, `data-unless`, `visibleIf`):
  - **Falsy:** absent, `null`, `false`, `""`, any decimal string equal to zero (`"0"`, `"0.00"`),
    an empty array, an empty object.
  - **Truthy:** everything else.
  - So `data-if="discount_total"` hides a zero discount row, and `data-if="company_logo"` hides an
    unset logo.

### 6.3 Hideable table columns

A cell in a table's **first row** may carry `data-if` or `data-unless`. It hides that **whole
column**. The compiler emits the condition on the column:

```json
"columns": [
  { "width": "auto" },
  { "width": 45, "visibleIf": { "path": "hide_gst_column", "negate": true } },
  { "width": 70 }
]
```

The renderer evaluates each column's `visibleIf`. For a hidden column it:
1. drops that column's cells in every row;
2. reduces the `colSpan` of any cell spanning it by the number of hidden columns it covers, and
   drops a cell whose whole span is hidden;
3. lays out the remaining columns as if the hidden one never existed.

A condition on a cell in any other row is a compile error.

A **static row** (a header or footer row, or a body row in a table without a repeat) may carry
`data-if` / `data-unless` too. It compiles to the row's own `visibleIf`, and the renderer leaves the
row out when it's off — for example a CGST/SGST line in a totals `<tfoot>`. The `data-repeat` row
can't: put the condition on the `<table>`.

```json
{ "type": "row", "style": { … }, "visibleIf": { "path": "discount_total" }, "cells": [ … ] }
```

### 6.4 Authoring

Fields are declared as JSON on the section's element, the same way `data-customisation` works today:

```html
<div class="top"
     data-section="header"
     data-section-label="Invoice details"
     data-hidable="false"
     data-fields='[
       {"id":"invoice_number","type":"invoice_number","label":"Invoice no."},
       {"id":"invoice_date","type":"date","label":"Date","default":{"kind":"today"}},
       {"id":"due_date","type":"due_date","label":"Due date","remember":true,"presets":[0,7,15,30]},
       {"id":"po_number","type":"text","label":"PO number","remember":true}
     ]'>
  <div class="no">{{ invoice_number }}</div>
  <div>{{ invoice_date | date }}</div>
  <div data-if="due_date">Due {{ due_date | date }}</div>
  <div data-if="po_number">PO: {{ po_number }}</div>
</div>

<div data-section="items" data-section-label="Items" data-hidable="false"
     data-fields='[
       {"id":"line_items","type":"line_items","label":"Items","columns":[
         {"id":"description","label":"Item"},
         {"id":"quantity","type":"number","label":"Qty","default":{"kind":"value","value":"1"}},
         {"id":"unit_price","label":"Rate"},
         {"id":"tax_rate","label":"GST %","default":{"kind":"setting","id":"settings_default_tax_rate"}},
         {"id":"line_total","type":"computed","label":"Amount"}
       ]},
       {"id":"hide_gst_column","type":"boolean","label":"Hide GST column","remember":true}
     ]'>
  <table data-if="line_items">
    <thead><tr>
      <th>Item</th><th>Qty</th><th>Rate</th>
      <th data-unless="hide_gst_column">GST</th>
      <th>Amount</th>
    </tr></thead>
    <tbody><tr data-repeat="line_items as item">
      <td>{{ item.description }}</td>
      <td>{{ item.quantity | number }}</td>
      <td>{{ item.unit_price | currency }}</td>
      <td>{{ item.tax_rate | number }}%</td>
      <td>{{ item.line_total | currency }}</td>
    </tr></tbody>
  </table>
  <div class="empty" data-unless="line_items" data-editor-only>+ Add an item</div>
</div>
```

`description`, `unit_price` and `tax_rate` leave out `type`, so they inherit it from the product
form. `quantity` isn't on any form, so it must give one.

The attributes, all on one element per section:

| Attribute | Meaning |
| --- | --- |
| `data-section="<id>"` | Tags the element as part of the section. Several elements may share an id. |
| `data-section-label="…"` | The section's editor title. Default: the id, humanised (`payment_details` → "Payment details"). |
| `data-hidable="false"` | The section can't be hidden. Default `true`. |
| `data-fields='[ … ]'` | The section's field definitions (§4), in editor order. |
| `data-section-order="a b c"` | On the ROOT: the editor's section order. Must name every section once. Default: the order each section first appears in the document. |

### 6.5 What fails a publish

The compiler rejects a template, with the exact location, when:

1. `data-fields` isn't a JSON array of objects, a section declares `data-fields` twice, or a section
   has more than 64 fields.
2. A field id isn't on the backend list, is `settings`-owned, or is in the wrong place. A `line` or
   `line_computed` id is only allowed inside `line_items` `columns`, and nothing else is allowed
   there.
3. A `type` is unknown, missing with nothing to inherit, or not allowed on that id (§4.3).
4. `remember` is set on a `company` or `customer` field. Those are saved on their record already.
5. The same id is listed in two sections.
6. A section lists `customer_*` fields without the `customer` picker field listed first.
7. A printed or tested path (§6.2) isn't a listed field, a computed id, or (inside the repeat) a
   listed column or line computed id. This means everything printed can be edited.
8. `data-repeat` iterates anything other than `line_items`.
9. A `visibleIf` path isn't a listed field, or a `default` names something that isn't a `settings_*`
   id.
10. A section id isn't `snake_case`, or a `customisation` control names a section or token the
    template doesn't declare.
11. A table-cell condition is outside the first row (§6.3), or the `data-repeat` row has a condition.
12. A field definition has an unknown attribute (a typo such as `lable`), sets `owner`, or uses a
    type-specific attribute on the wrong type (`options` on a text field).
13. An image is printed as text, or an `<img>` binds anything but an image's `.url` /
    `.thumbnailUrl`; or `discount`, `line_items` or `customer` is printed (print `discount_total`,
    iterate the lines, print `customer_name`).
14. `data-if` / `data-unless` / `data-repeat` sits where it can't work: on an inline element, a
    `<thead>`/`<tbody>`/`<tfoot>`, an `<ol>` item, or the root; or a repeat is nested, or its alias is
    a field id.
15. `data-section-order` misses or repeats a section, or a section is declared on two elements.

## 7. Records and the API

### 7.1 Rules for every values map

- **Keys** must be registered ids with an owner the record accepts (below). An unknown key is a
  `400`.
- **JSON kinds:** values are a string, boolean, object (`image`, `signature`, `discount`) or `null`.
  Numbers travel as **decimal strings**, never JSON numbers.
- **Validated strictly:** only shape and size, plus the **money inputs** (§7.7). Formats such as a
  GSTIN checksum are **never** rejected by the server, so a user is never blocked.
- **Sizes:** a string is at most 5,000 characters, and a URL at most 1,000 and `https:` only. A whole
  values map is at most **64 KB**. An invoice has at most **500** lines, each with at most 8 KB of
  values. These limits are also mirrored in `/config` `limits` (`maxValuesBytes`,
  `maxLineValuesBytes`, `maxLineItems`). A request body is still capped at 2 MB, so chunk a sync push
  of large invoices accordingly.
- **Writes:** `PUT` / `POST` with an existing id is a **full replace**. `PATCH` **merges**: a key
  set to `null` is cleared and an absent key is untouched.
- **Other conventions are unchanged:** client-generated uuids, idempotent writes by `(userId, id)`,
  and a foreign or missing id returns `404`.

### 7.2 Business profile

- `GET /company` returns `{ "values": { "company_name": …, … }, "createdAt", "updatedAt" }`, or
  `data: null` if it isn't set up yet.
- `PUT /company { "values": { … } }` replaces it; `PATCH /company { "values": { … } }` merges. Keys
  must be `company`-owned. A PATCH with no profile yet creates one, so an invoice can write a company
  field back before the profile screen was ever opened.

### 7.3 Settings

- `GET /settings` returns `{ "values": { … }, "updatedAt" }`. It is created on first read with the
  settings form's defaults.
- `PUT /settings` replaces and `PATCH /settings` merges. Keys must be `settings`-owned.

### 7.4 Customers

- `POST /customers { "id": "uuid", "values": { "customer_name": …, … } }` creates or replaces
  (`201`). Keys must be `customer`-owned.
- `GET /customers?q=&limit=&cursor=`: `q` matches `customer_name`, `customer_phone` and
  `customer_gstin`.
- `GET`, `PATCH` (merge) and `DELETE` (hard delete) on `/customers/:id`.
- Each item is `{ "id", "values", "createdAt", "updatedAt" }`.

### 7.5 Products

The same as customers, with `line`-owned keys (excluding `quantity`). `q` matches `description`.
A deleted product keeps its photo in storage.

### 7.6 Invoices

`POST /invoices` creates or replaces (`201`), idempotent by `(userId, id)`:

```json
{
  "id": "uuid",
  "templateId": "amber",
  "templateVersion": 2,
  "status": "Draft",
  "values": {
    "customer": "6f1c…",
    "invoice_number": "INV-42",
    "invoice_date": "2026-10-21",
    "due_date": "2026-11-05",
    "currency": "INR",
    "po_number": "PO-7781",
    "discount": { "kind": "percent", "value": "10", "beforeTax": true },
    "notes": "Thank you for your business.",
    "hide_gst_column": false,
    "company_name": "Kaveri Craft Studio",
    "company_state": "29",
    "company_signature": { "url": "https://…/a.webp", "thumbnailUrl": "https://…/a_thumb.webp" },
    "customer_name": "Meridian Home Stores LLP",
    "customer_state": "29"
  },
  "lineItems": [
    { "id": "uuid", "values": { "description": "Brand identity design", "hsn_sac": "998391",
                                "quantity": "1", "unit_price": "4500000", "tax_rate": "18" } }
  ],
  "hiddenSections": ["terms"],
  "themeOverrides": { "accent": "#c2410c" },
  "pdfPath": null,
  "updatedAt": "2026-10-21T10:00:00.000Z",
  "deletedAt": null
}
```

- **`values`** accepts `invoice`-, `company`- and `customer`-owned keys. The company and customer
  keys are the **copy** this invoice prints (§8.4). `line_items` itself is never a key here, because
  lines travel in `lineItems`.
- **`lineItems`**: array order is line order. Line `values` accept `line`-owned keys.
- **`status`** stays a top-level field (`Draft` | `Pending` | `Paid`), because the freeze rule
  (§8.4) and list filters depend on it.
- **The response** echoes everything and adds what the server calculated:
  - `"computed": { "subtotal", "discount_total", "tax_total", "cgst_total", "sgst_total",
    "igst_total", "grand_total" }`;
  - on each line, `"computed": { "line_total", "tax_amount" }`;
  - plus `createdAt`.
  - Any computed values the client sends are ignored.
- **Duplicate numbers:** a non-empty `invoice_number` already used by another of the user's
  non-deleted invoices is a `409`, as today. An empty number is allowed (drafts).
- **`GET /invoices?limit=&cursor=&status=&q=`:** `q` matches `invoice_number`, `customer_name` and
  `customer_phone`. Soft-deleted invoices are excluded.
- **`PATCH /invoices/:id`** with `{ "status"?, "pdfPath"?, "values"?, "updatedAt" }` merges `values`
  and recalculates.
- **`DELETE /invoices/:id`** and **`POST /invoices/sync`** keep their current mechanics:
  last-write-wins by `updatedAt`, tombstones, a bounded pull and an opaque cursor. Only the invoice
  shape changes.

### 7.7 Money inputs

The money calculation (see [`MONEY.md`](MONEY.md)) reads only these. They are validated strictly,
because totals depend on them:

| id | Rule | If absent |
| --- | --- | --- |
| `quantity` | non-negative decimal string | `0` |
| `unit_price` | non-negative integer paise string | `0` |
| `tax_rate` | decimal string from 0 to 100 | `0` |
| `discount` | `{ kind, value, beforeTax }` as in §4.3 | no discount |
| `currency` | ISO 4217 code | `INR` |
| `company_state`, `customer_state` | a state code from `indian_states` | GST is split as IGST |

A malformed money input is a `400` (for sync, a `conflicts` entry). A missing one uses the "If
absent" value, so an empty draft still saves.

## 8. Rules the app follows

### 8.1 Building the render context

```
{ ...invoice.values,
  line_items: [ { ...line.values, line_total, tax_amount }, … ],
  subtotal, discount_total, tax_total, cgst_total, sgst_total, igst_total, grand_total }
```

The app calculates the computed values with the same rules as the server. The server's figures
replace the app's on sync.

### 8.2 Starting values on a new invoice

Each field starts with the first of these that applies:

1. **`company_*`:** the business profile's current value.
2. **`customer_*`:** empty until a customer is picked, then that customer's values.
3. **`invoice_number`:** `settings_invoice_prefix` + `settings_next_invoice_number`. The app then
   increments the next number. On a device that has synced invoices, it never goes below the
   highest number already used.
4. **Any other field:** the remembered value (if `remember` is on, one is stored, and it fits the
   field's type), else the field's `default`, else empty.

A new line follows step 4 per column, unless it was picked from a product, in which case it gets
the product's values.

### 8.3 Remembered values

- They are stored on the device only, keyed by field id, and never sent to the server.
- They are updated whenever the user changes a `remember: true` field.
- What is kept depends on the type (§4.3). For `due_date` it's the gap in days.
- A remembered value that doesn't fit the current field's type is ignored. Two templates can give
  the same id different types.

### 8.4 Write-back, freezing and switching

- **Company fields** edited inside an invoice update the business profile too (`PATCH /company`).
- **Customer fields** edited inside an invoice update the picked customer
  (`PATCH /customers/:id`). If no customer is picked, the app creates one on save
  (`POST /customers`) and sets `values.customer` to its id.
- **Line items** never write back to products.
- **Drafts follow the live records:** while `status` is `Draft`, the invoice's copy of all company
  and customer values is refreshed from the profile and customer.
- **Issued invoices are frozen:** once the status leaves `Draft`, the copy only changes if the user
  edits it inside that invoice. Such an edit still writes back.
- **The copy is complete:** the whole profile and the whole customer, not just the fields the
  template prints. Switching template later never finds a value missing.
- **Switching templates keeps every value.** A field the new template doesn't list is kept but not
  printed.

### 8.5 Images

- Upload with `POST /media` and store `{ url, thumbnailUrl }`.
- Cache images by URL forever, because an image never changes under a URL.
- Replacing a logo or signature creates a new URL. Older invoices keep pointing at the old one,
  which is never deleted while referenced.

## 9. Removed

- **Templates:**
  - `sections[].edits` and the compiler's fixed section list;
  - the binding paths `company.*`, `customer.*`, `invoice.*`, `items[]`, `payment.*` and
    `signature.*`;
  - `data-repeat="items as item"` (now `line_items`).
- **REST shapes:**
  - every named field on `/company`, `/settings`, `/customers` and `/products`;
  - on invoices: `invoiceNumber`, `invoiceDate`, `dueDate`, `currency`, `notes`, `customerId`,
    `customerSnapshot`, `companySnapshot`, `discountType`, `discountValue`, `discountBeforeTax`,
    `items[]`, `subtotal`, `discountTotal`, `taxTotal`, `grandTotal` and `gstSplit`.
- **The REST-to-binding name table in API.md.** A field now has one name everywhere, which removes
  the APP-011 data-loss class.
- **The seed templates** `classic`, `minimal` and `bold`, which are replaced by versions in this
  structure.
- **`settings.defaultTemplateId`.** The app can remember the last template used on the device.

## 10. Rollout

**Done.** All backend steps shipped in `3c65776` and `90aa72c`, with every `check:*` script green.
Amber, Amethyst and Cobalt were rewritten and are kept in `catalog/`. Production was wiped,
migrated and republished on 2026-10-22 (BE-022).

**Backend**
1. The id list, forms and option lists in code; `GET /forms`; and a `check:forms` script (ids
   unique, prefixes match owners, form types valid).
2. Compiler v2: sections with fields, hideable columns, the checks in §6.5, version 2, and removal
   of the fixed section list.
3. Database: company, customer, product, settings, invoice and line rows store `values` JSON, plus
   the few columns the server reads (names and numbers for search, status, totals).
4. Services and validation for values maps. The money module reads the money ids, and the GST split
   reads `company_state` / `customer_state`.
5. Thumbnail renderer: the sample invoice in the new ids, and the truthiness rule in §6.2.
6. Templates: Amber, Amethyst and Cobalt rewritten and published as new templates; seeds replaced;
   the `new-invoice-template` skill updated.
7. `/config`: the new limits mirrored. Legal pages: describe the extra fields a user can enter.
8. Docs: TEMPLATE_JSON, TEMPLATE_AUTHORING, API, MONEY and REMOTE_CONFIG; their contract-folder
   copies; and a **breaking** `BE-021` changelog entry for the app.
9. `check:*` scripts updated; `typecheck` clean.

**Production** (I'll confirm with you before running this):
1. Delete all data: every table, including users and sessions, so everyone is signed out.
2. Delete every object under `media/` and `templates/` in the S3 bucket.
3. Deploy and migrate, then publish the three templates.

**App** (for the BE-021 entry):
- one form renderer for template sections and `/forms`;
- values maps on every record;
- the render context in §8.1;
- the device-only remember store;
- the write-back and freeze rules;
- column hiding.

## 11. Not in v1 (can be added later without breaking anything)

- A ship-to address, amount in words, per-line discounts, and invoice number padding (`INV-0042`).
- Syncing remembered values.
- **Two devices issuing numbers offline** can both use the same number. The server's `409` surfaces
  it as a sync conflict, but nothing prevents it.
