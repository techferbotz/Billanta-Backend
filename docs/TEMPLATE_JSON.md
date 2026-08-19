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
  "schemaVersion": 1,
  "compilerVersion": 1,
  "page": {
    "size": "A4",
    "margin": { "top": 36, "right": 36, "bottom": 36, "left": 36 },
    "fontFamily": "Inter",
    "baseFontSize": 11
  },
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
- `theme`, `sections` and `customisation` (all **optional**) — the template-customisation layer,
  present only when the template declares colour tokens / named sections / an explicit control list.
  See "Template customisation" below.

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

`fontFamily` is always one of the app-bundled fonts (Inter, Roboto, Open Sans, Lato, Montserrat) —
the compiler rejects any other, so the renderer never has to fall back to a system face.

## Values and spans

A dynamic value is a **literal** or a **binding**:

```json
{ "kind": "literal", "text": "Invoice" }
{ "kind": "bind", "path": "invoice.number", "format": "text", "fallback": "" }
```

- `path` — a dotted path into the invoice data (see the binding namespace below). Inside a
  `repeat`/table body it uses the loop alias (e.g. `item.amount`).
- `format` — a **hint** for the client: `"text" | "currency" | "date" | "number"`. Formatting stays
  on the client, which formats using the invoice's currency and locale (so a currency binding is
  printed as, e.g., `₹5,310.00`). The compiler never formats.
- `fallback` — a literal string to show when the bound path resolves empty (`""` if none).

A **span** is a run of text within a `text` node, with an optional inline `style` and — like a node —
an optional `tokens` map (APP-006), so a coloured inline run (e.g. a bold total) recolours with its
theme rather than keeping the literal hex:

```json
{ "value": { "kind": "literal", "text": "Total: " } }
{ "value": { "kind": "bind", "path": "invoice.total", "format": "currency", "fallback": "" },
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
| `table` | `{ type, style, columns: [{width: number\|"auto"}], header: Row[], body: TableBody, footer: Row[] }` | see below |
| `row` | `{ type, style, cells: Cell[] }` | |
| `cell` | `{ type, style, colSpan: number, children: Node[] }` | |
| `repeat` | `{ type, path, as, child: Node }` | render `child` once per element of the array at `path`, binding each to `as` |
| `conditional` | `{ type, path, negate?, child: Node }` | render `child` only when `path` is truthy; with `negate: true` (from `data-unless`) only when it is FALSY |

**`TableBody`** is EITHER a repeating row or a list of static rows (never both):

```json
"body": { "repeat": { "path": "items", "as": "item" }, "row": { "type": "row", ... } }
"body": { "rows": [ { "type": "row", ... } ] }
```

`columns` gives each column a `width` (points, or `"auto"` to size to content), expanded for
`colSpan`. When a `repeat`/`conditional` wraps an element that also has the other, the
`conditional` is outermost (gate, then repeat).

Additionally, **any node may carry optional keys** — `section` (a string id) and `tokens` (a style-key
→ token-name map) for the customisation layer described next, and **`editorOnly: true`** (APP-008): the
app renders an editor-only node ONLY while editing and drops it from every export (PDF/PNG/JPEG), so a
template can author an empty-state placeholder that never prints on a real invoice. All are optional and
appear only on tagged nodes. A renderer that ignores them draws as before — which means it would print
an `editorOnly` node, so only mark nodes that are safe to omit.

## Template customisation — colour tokens + named sections (optional)

Two optional, additive layers let the app **recolour** a template and **hide blocks** at render
time, with no bespoke server compile and no change to `(templateId, version)` immutability. Both
obey the forward-compatibility rule: a template that omits them is unchanged, and a renderer that
ignores them renders exactly as today.

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

### Named sections

Document-level `sections` tags the top-level blocks so the app can build show/hide toggles **and its
sectioned editor**. Each entry also declares `edits` — what data tapping the section edits (APP-007):

```json
"sections": [
  { "id": "header",  "label": "Invoice details", "hidable": false, "edits": "invoiceDetails" },
  { "id": "parties", "label": "Bill to",         "hidable": false, "edits": "customer" },
  { "id": "items",   "label": "Items",           "hidable": false, "edits": "items" },
  { "id": "totals",  "label": "Total",           "hidable": false, "edits": "discount" },
  { "id": "notes",   "label": "Notes",           "hidable": true,  "edits": "notes" },
  { "id": "payment", "label": "Payment details", "hidable": true,  "edits": "bankDetails" },
  { "id": "signature", "label": "Signature",     "hidable": true,  "edits": "signature" }
]
```

and the corresponding node carries `"section": "payment"`. `hidable: false` marks blocks that must
always render (invoice details, bill-to, items, total). The app hides a block whose id is in the
invoice's `hiddenSections`.

- **`edits`** vocabulary: `invoiceDetails`, `customer`, `items`, `discount`, `notes`, `bankDetails`,
  `signature`, `none`. It is **optional** — absent or an unrecognised value is treated as `none` (shown
  on the page, absent from the editor list), so a new editor kind ships backend-first. `bankDetails`
  (bank name / account / IFSC / UPI) and `signature` (signature image + signatory) both edit fields on
  the **company profile**, but each opens a focused editor — they replaced the earlier `company` value.
- The **`sections` array order is the editor's fill order** — details, customer, items, total, then
  the optional blocks.
- An unknown `section` id is ignored, so the vocabulary can grow. Known ids: `header, parties, items,
  totals, payment, notes, signature, terms`.

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
- A control naming a token/section the template doesn't declare, or a `type` the app doesn't know, is
  **ignored** — never a hard error — so new control types ship backend-first, exactly like new node
  types.
- **Omitting `customisation` keeps today's behaviour**: the app synthesises the sheet from
  `theme.tokens` + `sections`. Add the array only where a template wants explicit control (a second
  colour, a renamed or reordered control, exposing only some tokens).

### Where the user's choice is stored

The per-invoice customisation lives on the **invoice**, not the template — so it survives re-render
and syncs across devices: `themeOverrides` (`{ tokenName: "#hex" }`) and `hiddenSections`
(`["sectionId", …]`). See [API.md](API.md) § Invoices. A missing value means "template defaults".
Not every template declares tokens/sections; the app's controls simply appear when one does.

## Binding namespace

Paths available to templates:

```
company.*    name, gstin, addressLine1/2, city, state, stateCode, pincode, country,
             phone, email, logo, signature, upiId, qr, bankName, accountNumber, ifsc
customer.*   name, gstin, phone, email, addressLine1/2, city, state, stateCode, pincode
invoice.*    number, date, dueDate, currency, subtotal, tax, discount, total, notes, status
items[]      description, hsnSac, quantity, unitPrice, taxRate, amount
payment.*    upi, qr, bankName, accountNumber, ifsc
signature.*  url, name, designation
```

The concrete data the client binds these against comes from the invoice and its company/customer
**snapshots** (captured at issue time), so an invoice re-renders identically forever.

> **These are template render paths, not `/company` REST field names.** The client assembles this
> namespace from the stored profile and renames several leaves: `company.logo` ← `logoUrl`,
> `company.signature` / `signature.url` ← `signatureUrl`, `company.accountNumber` ← `bankAccountNumber`,
> `company.ifsc` ← `bankIfsc`, `company.qr` ← `qrImageUrl`. When reading or writing `GET`/`PUT /company`
> use the **REST** field names — see [API.md § Company](API.md). (`signature.name`/`signature.designation`
> map to `signatoryName`/`signatoryDesignation`.)

## Determinism

The same HTML+CSS always compiles to a **byte-identical** tree with an identical `sha256`
`checksum` (no clock, no randomness, fixed key order). The checksum is the `ETag` on
`GET /templates/:id/compiled`, and a `(templateId, version)` pair is immutable — so a client can
cache a downloaded tree forever.

## Worked example

Authored:

```html
<div class="page" data-page-size="A4">
  <h1>{{ invoice.number }}</h1>
  <table>
    <tbody>
      <tr data-repeat="items as item">
        <td>{{ item.description }}</td>
        <td>{{ item.amount | currency }}</td>
      </tr>
    </tbody>
  </table>
  <p data-if="payment.upi">Pay: {{ payment.upi }}</p>
</div>
```
```css
.page { padding: 40px; } h1 { font-size: 20px; color: #123456; }
```

Compiles to (abridged):

```json
{
  "schemaVersion": 1,
  "compilerVersion": 1,
  "page": { "size": "A4", "margin": { "top": 30, "right": 30, "bottom": 30, "left": 30 },
            "fontFamily": "Inter", "baseFontSize": 11 },
  "root": {
    "type": "box",
    "style": {},
    "children": [
      { "type": "text", "style": { "color": "#123456", "fontSize": 15 },
        "spans": [ { "value": { "kind": "bind", "path": "invoice.number", "format": "text", "fallback": "" } } ] },
      { "type": "table", "style": {}, "columns": [ { "width": "auto" }, { "width": "auto" } ],
        "header": [],
        "body": {
          "repeat": { "path": "items", "as": "item" },
          "row": { "type": "row", "style": {}, "cells": [
            { "type": "cell", "style": {}, "colSpan": 1, "children": [
              { "type": "text", "style": {}, "spans": [ { "value": { "kind": "bind", "path": "item.description", "format": "text", "fallback": "" } } ] } ] },
            { "type": "cell", "style": {}, "colSpan": 1, "children": [
              { "type": "text", "style": {}, "spans": [ { "value": { "kind": "bind", "path": "item.amount", "format": "currency", "fallback": "" } } ] } ] }
          ] }
        },
        "footer": []
      },
      { "type": "conditional", "path": "payment.upi", "child": {
          "type": "text", "style": {}, "spans": [
            { "value": { "kind": "literal", "text": "Pay: " } },
            { "value": { "kind": "bind", "path": "payment.upi", "format": "text", "fallback": "" } } ] } }
    ]
  }
}
```

Note `40px → 30pt` (× 0.75), `20px → 15pt`, `#123456` kept as hex, and `color`/`fontSize` inherited
onto the `h1` text node. The renderer just draws this — no CSS knowledge required.
