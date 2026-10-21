# Template Authoring Guide

Billanta templates are authored in a **strict subset of HTML + CSS**. The backend compiler
validates and compiles them into Billanta Template JSON (see
[`TEMPLATE_JSON.md`](TEMPLATE_JSON.md)); the mobile app renders that JSON — it never renders your
HTML. So HTML/CSS here is an **authoring language**, not a runtime.

Anything outside the subset is **rejected at compile time with an exact location**, e.g.
`css: unsupported property "animation" in rule ".header" (line 12)` or
`html: unsupported tag <script> (line 4)`. A rejected template is never stored.

Author and compile templates in the admin panel at `GET /admin`.

## Structure

A template is **one root element** (the page). Put the page size on it:

```html
<div data-page-size="A4"> … </div>
```

The root element's `padding` becomes the page print margin (default 36pt); its `font-family` and
`font-size` become the document defaults.

## Supported HTML tags

`div, span, p, h1`–`h6, table, thead, tbody, tfoot, tr, td, th, img, hr, br, strong, em, ul, ol, li`

Everything else is rejected, including `script`, `iframe`, `form`, `style`, `link`, `svg`. Event
handler attributes (`onclick`, any `on*`) are rejected. Nesting deeper than 200 levels is rejected.

- **`<img>`** — `src` **must be a binding** to an image field's url (`{{ company_logo.url }}`, see
  below), never an external URL, and it may not have a `?? fallback`. Optional `data-fit="cover"`
  (default `contain`).
- **`<td>`/`<th>`** — optional `colspan` (1–64).
- **`<ol>`** — numbered automatically at compile time. An `<ol>` inside a `data-repeat` is rejected
  (the count would be dynamic, so static numbers can't be correct).

## Supported CSS

**Properties:** `display` (`flex`/`block`/`none`), `flex-direction`, `justify-content`,
`align-items`, `flex-wrap`, `gap`, `flex`, `padding`/`padding-*`, `margin`/`margin-*`,
`width`/`height`/`min-*`/`max-*`, `border`/`border-*`/`border-radius`, `background`/`background-color`,
`color`, `font-size`, `font-weight`, `font-style`, `font-family`, `line-height`, `text-align`,
`text-transform`, `letter-spacing`, `overflow`, `vertical-align`, `opacity`.

**Rejected:** animations, transitions, transforms, filters, `float`, `position`, `box-sizing`, media
queries, pseudo-classes/elements, `calc()`, external fonts, and any `url(...)` / external resource.
Sizing is always **content-box** (CSS's default): a `width` is the content width, and padding and
border are added outside it — see [Tips](#tips).

**Selectors:** tag (`td`), class (`.total`), id (`#footer`), descendant (`.items td`) and child
(`.items > tr`) combinators, and comma lists (`h1, h2`). Rejected: `*`, `:hover`, `::before`,
`[attr]`, `+`/`~` siblings.

**Cascade:** specificity → source order, and an inline `style="…"` attribute wins over rules.
Inheritable text properties (`color`, `font-*`, `line-height`, `text-align`, `letter-spacing`,
`text-transform`) inherit down the tree — the compiler resolves all of this so the client doesn't.

**Units:** `px` (converted to points at ×0.75), `pt`, `%` (on width/height/min/max/margin), and
`auto` (on margin, width/height). No `em`/`rem`/`vw`/`vh`/`calc()`.

**Colors:** hex (`#1a1a1a`, `#f00`, `#rrggbbaa`), `rgb()`/`rgba()`, or a named color from the
common set (black, white, gray, red, blue, …). Everything is normalized to canonical hex.

**Fonts:** `font-family` must be one of **Inter, Roboto, Open Sans, Lato, Montserrat**, or a generic
(`sans-serif`, which maps to Inter). Any other family is rejected. **Today the app draws every
template in Inter**, whatever font the template names (APP-013). Only the picker thumbnail shows
the other faces. Design in Inter if you want the thumbnail and the printed invoice to match.

## Bindings

Insert dynamic data with `{{ … }}`. Every path is a **field id** — the full list, and what each one
is, is [`FIELDS.md`](FIELDS.md) §3.3:

```
{{ invoice_number }}                     text
{{ item.line_total | currency }}         format hint: text | currency | date | number
{{ due_date | date }}
{{ customer_gstin ?? 'N/A' }}            fallback shown when the value is empty
<img src="{{ company_logo.url }}">       an image prints through its url
```

- The **format** is a hint; the app formats currency/date/number using the invoice's currency and
  locale. Don't pre-format in the template.
- A binding can appear in text, or as an `<img src>` (where the whole `src` must be exactly one
  binding, to an image's `.url` or `.thumbnailUrl`).
- The calculated values — `subtotal`, `discount_total`, `tax_total`, `cgst_total`, `sgst_total`,
  `igst_total`, `grand_total` — can be printed anywhere. **Every other path must be a field some
  section lists** (next section). The compiler rejects anything else, so a typo fails the publish
  instead of printing blank, and everything on the page can be edited.
- A select (`company_state`, `customer_state`) prints its label ("Karnataka"), not its code.
- An id the template needs that isn't in the registry is added to `src/fields/registry.ts` first (a
  backend deploy); a template never invents one.

## Sections and their fields

The template defines what the app's editor shows. Tag each block of the invoice as a **section** and,
on one of its elements, list the **fields** its editor edits:

```html
<div class="meta" data-section="header" data-section-label="Invoice details" data-hidable="false"
     data-fields='[
       {"id":"invoice_number","label":"Invoice no."},
       {"id":"invoice_date","label":"Date","default":{"kind":"today"}},
       {"id":"due_date","type":"due_date","label":"Due date","remember":true,"presets":[0,7,15,30]},
       {"id":"po_number","type":"text","label":"PO number","remember":true}
     ]'>
  <div>No. {{ invoice_number }}</div>
  <div>Date: {{ invoice_date | date }}</div>
  <div data-if="due_date">Due: {{ due_date | date }}</div>
  <div data-if="po_number">PO: {{ po_number }}</div>
</div>
```

| Attribute | Meaning |
| --- | --- |
| `data-section="<id>"` | Tags the element as part of the section (`snake_case`). Several elements may share an id. |
| `data-section-label="…"` | The editor's title for it. Default: the id, humanised. |
| `data-hidable="false"` | The user can't hide it. Default: hidable. |
| `data-fields='[ … ]'` | Its fields, in editor order — a JSON array in a single-quoted attribute. |
| `data-section-order="a b c"` | On the root element: the editor's section order (default: document order). |

A field definition is `{ "id", "type", "label", … }` — the attributes and types are
[`FIELDS.md`](FIELDS.md) §4. The essentials:

- **Company, customer and product ids inherit** their type and label from the global forms:
  `{"id":"company_gstin"}` is enough. **Invoice ids** (`po_number`, `notes`, `terms`,
  `hide_gst_column`, …) need a `type` and a `label`.
- **The line items** are one field with its own `columns`:
  `{"id":"line_items","label":"Items","columns":[{"id":"description","label":"Item"},{"id":"quantity","type":"number","label":"Qty"},{"id":"unit_price","label":"Rate"},{"id":"line_total","label":"Amount"}]}`.
- **Customer fields** need the `customer` picker listed first in the same section:
  `[{"id":"customer","label":"Customer"},{"id":"customer_name"},…]`.
- **`remember: true`** (invoice and line fields only) prefills the next invoice with the last value,
  on the device. Good for a due period, a PO number, a column switch.
- **`default`**: `{"kind":"today"}`, `{"kind":"value","value":"1"}` or
  `{"kind":"setting","id":"settings_default_notes"}`.
- There is no "required": a draft may be incomplete.
- A field belongs to **one** section but may be printed anywhere on the page.

## Repetition and conditionals (`data-*`)

- **`data-repeat="line_items as item"`** — repeat this element once per line, binding each to `item`
  (`item.description`, `item.line_total`). On a `<tr>` inside `<tbody>`, it becomes the table's
  repeating line-item row (the common case). A table body may have **either** one `data-repeat` row
  **or** static rows, not both. `line_items` is the only list there is, and repeats don't nest.
- **`data-if="company_upi_id"`** — render this element only when the value is truthy.
- **`data-unless="line_items"`** — the inverse: render only when the value is FALSY (empty, `false`,
  or a zero amount — so `data-if="discount_total"` hides a zero discount). Pair a `data-if` and a
  `data-unless` sibling for an empty state. An element may not carry both.
- **Hiding a column** — put `data-if`/`data-unless` on the column's cell in the table's **first row**;
  the whole column goes, and footer cells spanning it shrink. Elsewhere a cell condition is rejected.
- **Hiding a table row** — a static `<tr>` (header, footer, or a body without a repeat) may carry
  `data-if`/`data-unless`, e.g. a CGST line `<tr data-if="cgst_total">`. The `data-repeat` row can't.
- **`data-editor-only`** — mark an element the app renders ONLY while editing; it is dropped from every
  export (PDF/PNG/JPEG). Pair it with `data-unless` for an empty-state placeholder that never prints on
  a real invoice.

`data-if`/`data-unless`/`data-repeat` are rejected where they can't work: on inline elements
(`span`, `strong`, `em`), on `<thead>`/`<tbody>`/`<tfoot>`, on `<ol>` items, and on the root.

```html
<div data-section="items" data-section-label="Items" data-hidable="false"
     data-fields='[{"id":"line_items","label":"Items","columns":[{"id":"description","label":"Item"},{"id":"quantity","type":"number","label":"Qty"},{"id":"tax_rate","label":"GST %"},{"id":"line_total","label":"Amount"}]},
                   {"id":"hide_gst_column","type":"boolean","label":"Hide GST column","remember":true}]'>
  <table data-if="line_items">
    <thead>
      <tr><th>Item</th><th>Qty</th><th data-unless="hide_gst_column">GST</th><th>Amount</th></tr>
    </thead>
    <tbody>
      <tr data-repeat="line_items as item">
        <td>{{ item.description }}</td>
        <td>{{ item.quantity | number }}</td>
        <td>{{ item.tax_rate | number }}%</td>
        <td>{{ item.line_total | currency }}</td>
      </tr>
    </tbody>
    <tfoot>
      <tr data-if="discount_total"><td colspan="3">Discount</td><td>-{{ discount_total | currency }}</td></tr>
      <tr><td colspan="3">Total</td><td><strong>{{ grand_total | currency }}</strong></td></tr>
    </tfoot>
  </table>
  <div class="empty" data-unless="line_items" data-editor-only><div>+ Add an item</div></div>
</div>
```

## Worked examples

Three complete, compilable templates ship in
`src/templates/seed/seedTemplates.ts` (in the backend repo):

- **`classic`** — a conventional business invoice with a boxed items table, a payment block and
  notes; seven sections with `data-section-order`, the totals declared on a `<tfoot>` row.
- **`minimal`** — an airy, typographic layout with a borderless items list.
- **`bold`** (premium) — a colored-header invoice with a right-aligned summary panel (uses
  `margin-left: auto`).

They double as the compiler's end-to-end test corpus (`npm run check:seeds`), so every example in
them is guaranteed to compile.

## Tips

- Layout with **flexbox** (`display: flex`), not floats or positioning.
- Use `<table>` for the line-items grid; use `<div>` + flex for headers and blocks.
- Bold/italic inline runs work: `<strong>{{ grand_total | currency }}</strong>`.
- Check a template before publishing with
  `npx ts-node src/scripts/verifyTemplate.ts t.html t.css` — it compiles it, checks every themed
  colour is tokenised, and prints each section with the fields its editor will show.
- If a compile fails, the error names the phase, the offending token, and the source line — fix
  that and recompile. Nothing is stored until it compiles cleanly.
- **Don't set a `%` width and padding on the same element.** The app's renderer adds padding *on top
  of* a declared width, so two `width: 50%` cells with side padding overrun their row and push the
  right-hand one past the page edge (browsers hide this by shrinking flex items, so a browser preview
  won't show it). Put the width on an outer element and the padding on an inner one.

## The picker thumbnail

Publishing a version also renders its **picker thumbnail** — the image the app shows in the template
grid, and the only preview a non-premium user gets of a premium template. It's page 1, drawn from the
compiled tree the app downloads, in the default theme, filled with one fixed, fictional sample invoice
(every field populated: a logo, four GST line items, a discount, a PO number, notes and terms, bank +
UPI, a signature).

So design for a **full** invoice as well as an empty one: every section you declare will be populated,
and anything past the bottom of page 1 is cropped.

Preview it before publishing — exactly the image a publish uploads, no server or database needed:

```bash
npm run thumbnail:render -- --html t.html --css t.css --out t.png
```

A thumbnail that fails to render never blocks a publish: the panel shows the error beside the version
with a **Render thumbnail** button, and the picker keeps the previous image meanwhile.
