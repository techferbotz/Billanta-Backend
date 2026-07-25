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

- **`<img>`** — `src` **must be a binding** (see below), never an external URL, and it may not have
  a `?? fallback`. Optional `data-fit="cover"` (default `contain`).
- **`<td>`/`<th>`** — optional `colspan` (1–64).
- **`<ol>`** — numbered automatically at compile time. An `<ol>` inside a `data-repeat` is rejected
  (the count would be dynamic, so static numbers can't be correct).

## Supported CSS

**Properties:** `display` (`flex`/`block`/`none`), `flex-direction`, `justify-content`,
`align-items`, `flex-wrap`, `gap`, `flex`, `padding`/`padding-*`, `margin`/`margin-*`,
`width`/`height`/`min-*`/`max-*`, `border`/`border-*`/`border-radius`, `background`/`background-color`,
`color`, `font-size`, `font-weight`, `font-style`, `font-family`, `line-height`, `text-align`,
`text-transform`, `letter-spacing`, `overflow`, `vertical-align`, `opacity`.

**Rejected:** animations, transitions, transforms, filters, `float`, `position`, media queries,
pseudo-classes/elements, `calc()`, external fonts, and any `url(...)` / external resource.

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

**Fonts:** `font-family` must be one of the app-bundled fonts — **Inter, Roboto, Open Sans, Lato,
Montserrat** — or a generic (`sans-serif`, which maps to Inter). Any other family is rejected, so
the printed invoice never silently changes face.

## Bindings

Insert dynamic data with `{{ … }}`:

```
{{ invoice.number }}                     text
{{ item.amount | currency }}             format hint: text | currency | date | number
{{ invoice.dueDate | date }}
{{ customer.gstin ?? 'N/A' }}            fallback shown when the value is empty
```

- The **format** is a hint; the app formats currency/date/number using the invoice's currency and
  locale. Don't pre-format in the template.
- `path` is a dotted name from the binding namespace (below). The reserved names `__proto__`,
  `constructor` and `prototype` are rejected.
- A binding can appear in text, or as an `<img src>` (where the whole `src` must be exactly one
  binding).

### Binding namespace

```
company.*    name, gstin, addressLine1/2, city, state, stateCode, pincode, country,
             phone, email, logo, signature, upiId, qr, bankName, accountNumber, ifsc
customer.*   name, gstin, phone, email, addressLine1/2, city, state, stateCode, pincode
invoice.*    number, date, dueDate, currency, subtotal, tax, discount, total, notes, status
items[]      description, hsnSac, quantity, unitPrice, taxRate, amount
payment.*    upi, qr, bankName, accountNumber, ifsc
signature.url
```

## Repetition and conditionals (`data-*`)

- **`data-repeat="items as item"`** — repeat this element once per array element, binding each to
  `item`. On a `<tr>` inside `<tbody>`, it becomes the table's repeating line-item row (the common
  case). A table body may have **either** one `data-repeat` row **or** static rows, not both.
- **`data-if="payment.upi"`** — render this element only when the path is truthy.

```html
<table>
  <thead>
    <tr><th>Item</th><th>Qty</th><th>Amount</th></tr>
  </thead>
  <tbody>
    <tr data-repeat="items as item">
      <td>{{ item.description }}</td>
      <td>{{ item.quantity | number }}</td>
      <td>{{ item.amount | currency }}</td>
    </tr>
  </tbody>
  <tfoot>
    <tr><td colspan="2">Total</td><td><strong>{{ invoice.total | currency }}</strong></td></tr>
  </tfoot>
</table>

<div data-if="payment.upi">Pay via UPI: {{ payment.upi }}</div>
```

## Worked examples

Three complete, compilable templates ship in
[`src/templates/seed/seedTemplates.ts`](../src/templates/seed/seedTemplates.ts):

- **`classic`** — a conventional business invoice with a boxed items table, a payment block, and
  numbered terms.
- **`minimal`** — an airy, typographic layout with a borderless items list.
- **`bold`** (premium) — a colored-header invoice with a right-aligned summary panel (uses
  `margin-left: auto`).

They double as the compiler's end-to-end test corpus (`npm run check:seeds`), so every example in
them is guaranteed to compile.

## Tips

- Layout with **flexbox** (`display: flex`), not floats or positioning.
- Use `<table>` for the line-items grid; use `<div>` + flex for headers and blocks.
- Bold/italic inline runs work: `<strong>{{ invoice.total | currency }}</strong>`.
- If a compile fails, the error names the phase, the offending token, and the source line — fix
  that and recompile. Nothing is stored until it compiles cleanly.
