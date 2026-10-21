# Billanta Template JSON — the render-tree contract

This is the contract between the **backend compiler** and the **on-device renderer**. The
renderer is built against this spec. It is emitted by `src/templates/compile/` and served by
`GET /templates/:id/compiled`.

The guiding principle: the tree is **fully resolved**. Every node carries an absolute `style`
(cascade applied, inheritance flattened, units in points, colors as hex), and every dynamic value
is a typed binding node. The renderer does **no** cascade, **no** inheritance, **no** unit math,
**no** string interpolation — it walks the tree and draws.

## The forward-compatibility rule (read this first)

> **The renderer MUST ignore unknown node `type`s and unknown `style` keys rather than crash.**

Skip a node whose `type` you don't recognise (render nothing for it and continue), and ignore any
style key you don't handle. This single rule is what lets the backend ship new template
capabilities — new node types, new style properties — by publishing a new template version, with
**no Play Store release**. Never treat an unknown key/type as an error.

## Top-level document

```json
{
  "schemaVersion": 2,
  "compilerVersion": 2,
  "page": {
    "size": "A4",
    "margin": { "top": 36, "right": 36, "bottom": 36, "left": 36 },
    "fontFamily": "Inter",
    "baseFontSize": 11
  },
  "sections": [ { "id": "header", "label": "Invoice details", "hidable": false, "fields": [ ... ] } ],
  "root": { "type": "box", "style": { ... }, "children": [ ... ] }
}
```

- `schemaVersion` — structural version of this contract. `compilerVersion` — which compiler
  produced the tree; both are stamped on every compile. If a renderer sees a `compilerVersion`
  newer than it understands, it should still render (thanks to the ignore-unknown rule) and may
  prompt the user to update the app.
- `page.size` is `"A4"` for V1 (the field exists so more can be added compatibly).
- `page.margin` is in **points**, derived from the root element's padding (default 36pt ≈ 0.5in).
- `page.fontFamily` / `page.baseFontSize` (points) are the document defaults.
- `sections` — **always present** (empty when nothing is tagged): the blocks of the invoice, each
  with the fields its editor shows. See "Sections and their fields" below.
- `theme` and `customisation` (both **optional**) — colour tokens and an explicit control list,
  present only when the template declares them. See "Template customisation" below.
- Version 2 (server-driven fields, [FIELDS.md](FIELDS.md)) replaced section `edits` with field lists
  and the dotted binding paths (`invoice.number`) with flat field ids (`invoice_number`). A version-1
  tree is not served any more.

## Units, colors, values

- **Lengths are absolute POINTS** (numbers). The compiler converts CSS px → pt at `px × 0.75`
  (96dpi). `pt` passes through. `em`/`rem`/`vw`/`vh`/`calc()` are rejected at compile time — you
  will never see them.
- **Percentages** appear only for `width`/`height`/`min*`/`max*`/`margin*`, as a string like
  `"50%"`. Resolve them against the parent at layout time.
- `margin*` may also be the string `"auto"`.
- **Colors** are always canonical lowercase hex: `"#rrggbb"` or `"#rrggbbaa"` (with alpha). No
  named colors, no `rgb()`.
- **`line-height`** is a unitless multiplier (number) or a points value.
- **`opacity`** is a number in `[0, 1]`. **`fontWeight`** is a number `100–900`.

## The `style` object

A flat map of resolved properties (camelCase keys). Every node has one; it may be `{}`. Known keys
(a renderer may ignore any it doesn't support):

```
Layout:  display(flex|block|none), flexDirection, justifyContent, alignItems, flexWrap, gap(pt), flex(string)
Box:     paddingTop/Right/Bottom/Left(pt), marginTop/Right/Bottom/Left(pt|%|"auto"),
         width/height/minWidth/maxWidth/minHeight/maxHeight(pt|"x%")
Border:  borderTop/Right/Bottom/LeftWidth(pt), …Style(keyword), …Color(#hex), borderRadius(pt)
Fill:    backgroundColor(#hex)
Text:    color(#hex), fontSize(pt), fontWeight(100–900), fontStyle(normal|italic), fontFamily(string),
         lineHeight(number|pt), textAlign(left|right|center|justify), textTransform, letterSpacing(pt)
Misc:    overflow, verticalAlign, opacity(0–1)
```

`fontFamily` is always one of the five fonts the compiler accepts (Inter, Roboto, Open Sans, Lato,
Montserrat); any other is rejected. The Billanta app currently draws every template in Inter
regardless (APP-013), so a template's declared font shows only in its picker thumbnail. Whether to
align the two is an open decision (BE-018).

**Box model: content-box.** `width`, `height` and the `min*`/`max*` keys size a node's *content*.
Padding and border widths are added outside that, and margins outside those. So a node with
`width: 200pt`, `paddingLeft`/`paddingRight: 10pt` and 1pt left/right borders takes 222pt across, and a
`"50%"` width is 50% of the parent's content width *before* the node's own padding. This is CSS's
default, and the compiler guarantees it: `box-sizing` is rejected in template CSS (both values), so
no template can ask for border-box sizing. Renderers must lay out content-box.

## Values and spans

A dynamic value is a **literal** or a **binding**:

```json
{ "kind": "literal", "text": "Invoice" }
{ "kind": "bind", "path": "invoice_number", "format": "text", "fallback": "" }
```

- `path` — a field id, resolved against the render context (see "Bindings" below). Inside a
  `repeat`/table body it uses the loop alias (`item.line_total`); an image's url is
  `company_logo.url`.
- `format` — a **hint** for the client: `"text" | "currency" | "date" | "number"`. Formatting stays
  on the client, which formats using the invoice's currency and locale (so a currency binding is
  printed as, e.g., `₹5,310.00`). The compiler never formats.
- `fallback` — a literal string to show when the bound path resolves empty (`""` if none).

A **span** is a run of text within a `text` node, with an optional inline `style` and — like a node —
an optional `tokens` map (APP-006), so a coloured inline run (e.g. a bold total) recolours with its
theme rather than keeping the literal hex:

```json
{ "value": { "kind": "literal", "text": "Total: " } }
{ "value": { "kind": "bind", "path": "grand_total", "format": "currency", "fallback": "" },
  "style": { "fontWeight": 700, "color": "#222831" }, "tokens": { "color": "accent" } }
```

## Node types

Every node has `type` and `style`.

| type | shape | notes |
| --- | --- | --- |
| `box` | `{ type, style, children: Node[] }` | flex/block container |
| `text` | `{ type, style, spans: Span[] }` | a paragraph; merge each span's `style` over the node's |
| `image` | `{ type, style, source: Value, fit: "contain"\|"cover" }` | `source` is always a binding (external URLs are rejected at compile time) |
| `divider` | `{ type, style }` | a horizontal rule |
| `table` | `{ type, style, columns: [{width: number\|"auto", visibleIf?}], header: Row[], body: TableBody, footer: Row[] }` | see below |
| `row` | `{ type, style, visibleIf?, cells: Cell[] }` | a static row with `visibleIf` is drawn only when it's on (see below) |
| `cell` | `{ type, style, colSpan: number, children: Node[] }` | |
| `repeat` | `{ type, path, as, child: Node }` | render `child` once per element of the array at `path`, binding each to `as` |
| `conditional` | `{ type, path, negate?, child: Node }` | render `child` only when `path` is truthy; with `negate: true` (from `data-unless`) only when it is FALSY |

**`TableBody`** is EITHER a repeating row or a list of static rows (never both):

```json
"body": { "repeat": { "path": "line_items", "as": "item" }, "row": { "type": "row", ... } }
"body": { "rows": [ { "type": "row", ... } ] }
```

`columns` gives each column a `width` (points, or `"auto"` to size to content), expanded for
`colSpan`. When a `repeat`/`conditional` wraps an element that also has the other, the
`conditional` is outermost (gate, then repeat). A repeat only ever iterates `line_items`.

**`visibleIf`** — `{ "path": "<field id>", "negate"?: true }`, the same gate as a `conditional`
(shown when the value is truthy; with `negate`, when it's falsy):

- **On a column**, it hides the whole column. Drop that column's cells in every row; a cell whose
  `colSpan` covers hidden columns shrinks by that many, and a cell whose whole span is hidden is
  dropped; lay the remaining columns out as if the hidden one never existed.
- **On a row** (only ever a static row — header, footer, or a body without a repeat), it leaves the
  row out.

A renderer that ignores `visibleIf` draws every column and row — the safe fallback.

Additionally, **any node may carry optional keys** — `section` (a string id) and `tokens` (a style-key
→ token-name map) for the customisation layer described next, and **`editorOnly: true`** (APP-008): the
app renders an editor-only node ONLY while editing and drops it from every export (PDF/PNG/JPEG), so a
template can author an empty-state placeholder that never prints on a real invoice. All are optional and
appear only on tagged nodes. A renderer that ignores them draws as before — which means it would print
an `editorOnly` node, so only mark nodes that are safe to omit.

## Sections and their fields

Document-level `sections` lists the blocks of the invoice, in the **editor's order**. Each one carries
the fields its editor shows, fully resolved (owner, type, label and options already filled in), so the
app builds the editor from this alone:

```json
"sections": [
  { "id": "header", "label": "Invoice details", "hidable": false,
    "fields": [
      { "id": "invoice_number", "owner": "invoice", "type": "invoice_number", "label": "Invoice no." },
      { "id": "invoice_date",   "owner": "invoice", "type": "date", "label": "Date", "default": { "kind": "today" } },
      { "id": "po_number",      "owner": "invoice", "type": "text", "label": "PO number", "remember": true }
    ] },
  { "id": "payment", "label": "Payment details", "hidable": true,
    "fields": [ { "id": "company_upi_id", "owner": "company", "type": "upi_id", "label": "UPI ID" } ] }
]
```

- The **template** chooses each section's `id`, `label` and `hidable`. The nodes of a section carry
  `"section": "<id>"` — possibly several nodes, at any depth. The app hides every node of a section
  whose id is in the invoice's `hiddenSections`.
- **`fields`** are field definitions — the full spec (types, attributes, defaults, `remember`,
  where each value is saved, and what happens when a field is edited) is
  [FIELDS.md](FIELDS.md) §4 and §8. A field belongs to one section but may be printed anywhere.
- An unknown field `type` draws its `fallbackType`, or is hidden; an unknown attribute is ignored.

## Template customisation — colour tokens (optional)

Two optional, additive layers let the app **recolour** a template and pick the controls of its
customisation sheet at render time, with no bespoke server compile and no change to
`(templateId, version)` immutability. A template that omits them is unchanged, and a renderer that
ignores them draws the template's own colours.

### Colour tokens

Document-level `theme` (present only when the template declares tokens):

```json
"theme": {
  "tokens": {
    "accent": { "default": "#2b3648", "label": "Accent" }
  }
}
```

Each token is a named colour the user may override: `default` is the template's own hex (the same
value already in `style`); `label` is a human name for the colour picker. `accent` is the one users
most often change; a template may also declare `ink`, `muted`, etc.

Any node whose style uses a token also carries a `tokens` map from **style key → token name**, while
`style` keeps the literal hex:

```json
{ "type": "cell",
  "style":  { "backgroundColor": "#2b3648", "color": "#ffffff" },
  "tokens": { "backgroundColor": "accent" } }
```

`style` stays authoritative — a renderer that knows nothing about `tokens` draws the literal colour.
A renderer that does: wherever a node names a token for a style key, substitute the user's chosen
colour (from the invoice's `themeOverrides`) for that key, falling back to the token's `default`.

Because `color` is an inherited property, a `color` token is emitted on the **text nodes that
actually draw it** (not only on the element that declared it), so recolouring reaches every glyph in
that colour. Non-inherited colours (`backgroundColor`, `border*Color`) are tokenised on the element
that draws them. A **span** whose own `color` would otherwise override its node's token carries its
own `tokens.color` too (APP-006). Net effect: every element — node or span — rendered in a token's
colour carries the token, so an override never leaves a stray run in the old colour.

### Which controls to show (optional)

By default the app builds the customisation sheet by inference — the template switcher, then one
swatch per `theme.tokens`, then one toggle per hidable `sections` entry. A template can instead state
its sheet outright with a document-level `customisation` array, in display order:

```json
"customisation": [
  { "type": "template", "title": "Template" },
  { "type": "color",    "title": "Accent colour",   "token": "accent" },
  { "type": "section",  "title": "Payment details", "section": "payment" }
]
```

| `type` | extra field | meaning |
| --- | --- | --- |
| `color` | `token` — a `theme.tokens` name | pick a colour for that token |
| `section` | `section` — a `sections` id | show/hide that section |
| `template` | — | switch template; the app supplies the list |

- Order is display order. `title` is the label; the app falls back to the token/section id when it's
  omitted.
- The compiler rejects a control naming a token or section the template doesn't declare. A `type` the
  app doesn't know is **ignored** — never a hard error — so new control types ship backend-first,
  exactly like new node types.
- **Omitting `customisation` keeps today's behaviour**: the app synthesises the sheet from
  `theme.tokens` + `sections`. Add the array only where a template wants explicit control (a second
  colour, a renamed or reordered control, exposing only some tokens).

### Where the user's choice is stored

The per-invoice customisation lives on the **invoice**, not the template — so it survives re-render
and syncs across devices: `themeOverrides` (`{ tokenName: "#hex" }`) and `hiddenSections`
(`["sectionId", …]`). See [API.md](API.md) § Invoices. A missing value means "template defaults".
Not every template declares tokens/sections; the app's controls simply appear when one does.

## Bindings

Every path a template prints or tests is a **field id** — the same string the editor and the API
store the value under. The full list is [FIELDS.md](FIELDS.md) §3.3. The render context is flat
([FIELDS.md](FIELDS.md) §8.1):

```
{ ...invoice.values,                       invoice_number, po_number, company_name, customer_gstin, …
  line_items: [ { ...line.values, line_total, tax_amount }, … ],
  subtotal, discount_total, tax_total, cgst_total, sgst_total, igst_total, grand_total }
```

- **Images** are `{ url, thumbnailUrl }`, so an `<img>` binds `company_logo.url`; `company_logo` alone
  is the image as a whole (for `data-if`).
- **Inside the repeat**, `item.<id>` is a column of the line (`item.description`, `item.line_total`).
- **A select prints its option's label**, not its value: `company_state` = `"29"` prints "Karnataka".
  The label comes from the field's definition in `sections` (an option-list name resolves through
  `GET /forms` `optionLists`).
- **Truthiness** (`conditional`, `visibleIf`): absent, `null`, `false`, `""`, a decimal string equal to
  zero (`"0"`, `"0.00"`), an empty array or an empty object is falsy; everything else is truthy.
- The compiler guarantees every path is a field some section lists (or a computed id), so everything
  on the page can be edited and no path is a typo.

Because the invoice keeps its own copy of the company and customer values (frozen once it's issued),
an invoice re-renders identically forever.

## Determinism

The same HTML+CSS always compiles to a **byte-identical** tree with an identical `sha256`
`checksum` (no clock, no randomness, fixed key order). The checksum is the `ETag` on
`GET /templates/:id/compiled`, and a `(templateId, version)` pair is immutable — so a client can
cache a downloaded tree forever.

## Worked example

Authored:

```html
<div class="page" data-page-size="A4" data-section="main" data-section-label="Invoice" data-hidable="false"
     data-fields='[{"id":"invoice_number","label":"No."},
                   {"id":"line_items","label":"Items","columns":[{"id":"description"},{"id":"line_total"}]},
                   {"id":"company_upi_id"}]'>
  <h1>{{ invoice_number }}</h1>
  <table>
    <tbody>
      <tr data-repeat="line_items as item">
        <td>{{ item.description }}</td>
        <td>{{ item.line_total | currency }}</td>
      </tr>
    </tbody>
  </table>
  <p data-if="company_upi_id">Pay: {{ company_upi_id }}</p>
</div>
```
```css
.page { padding: 40px; } h1 { font-size: 20px; color: #123456; }
```

Compiles to (abridged):

```json
{
  "schemaVersion": 2,
  "compilerVersion": 2,
  "page": { "size": "A4", "margin": { "top": 30, "right": 30, "bottom": 30, "left": 30 },
            "fontFamily": "Inter", "baseFontSize": 11 },
  "sections": [
    { "id": "main", "label": "Invoice", "hidable": false, "fields": [
      { "id": "invoice_number", "owner": "invoice", "type": "invoice_number", "label": "No." },
      { "id": "line_items", "owner": "invoice", "type": "line_items", "label": "Items", "columns": [
        { "id": "description", "owner": "line", "type": "text", "label": "Product name" },
        { "id": "line_total", "owner": "line_computed", "type": "computed", "label": "Amount", "format": "currency" } ] },
      { "id": "company_upi_id", "owner": "company", "type": "upi_id", "label": "UPI ID" } ] }
  ],
  "root": {
    "type": "box",
    "style": {},
    "section": "main",
    "children": [
      { "type": "text", "style": { "color": "#123456", "fontSize": 15 },
        "spans": [ { "value": { "kind": "bind", "path": "invoice_number", "format": "text", "fallback": "" } } ] },
      { "type": "table", "style": {}, "columns": [ { "width": "auto" }, { "width": "auto" } ],
        "header": [],
        "body": {
          "repeat": { "path": "line_items", "as": "item" },
          "row": { "type": "row", "style": {}, "cells": [
            { "type": "cell", "style": {}, "colSpan": 1, "children": [
              { "type": "text", "style": {}, "spans": [ { "value": { "kind": "bind", "path": "item.description", "format": "text", "fallback": "" } } ] } ] },
            { "type": "cell", "style": {}, "colSpan": 1, "children": [
              { "type": "text", "style": {}, "spans": [ { "value": { "kind": "bind", "path": "item.line_total", "format": "currency", "fallback": "" } } ] } ] }
          ] }
        },
        "footer": []
      },
      { "type": "conditional", "path": "company_upi_id", "child": {
          "type": "text", "style": {}, "spans": [
            { "value": { "kind": "literal", "text": "Pay: " } },
            { "value": { "kind": "bind", "path": "company_upi_id", "format": "text", "fallback": "" } } ] } }
    ]
  }
}
```

Note `40px → 30pt` (× 0.75), `20px → 15pt`, `#123456` kept as hex, and `color`/`fontSize` inherited
onto the `h1` text node. `description` inherited its type and label from the product form, and
`company_upi_id` from the business-profile form. The renderer just draws this — no CSS knowledge
required.
