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

A **span** is a run of text within a `text` node, with an optional inline style:

```json
{ "value": { "kind": "literal", "text": "Total: " } }
{ "value": { "kind": "bind", "path": "invoice.total", "format": "currency", "fallback": "" }, "style": { "fontWeight": 700 } }
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
| `conditional` | `{ type, path, child: Node }` | render `child` only if `path` is truthy |

**`TableBody`** is EITHER a repeating row or a list of static rows (never both):

```json
"body": { "repeat": { "path": "items", "as": "item" }, "row": { "type": "row", ... } }
"body": { "rows": [ { "type": "row", ... } ] }
```

`columns` gives each column a `width` (points, or `"auto"` to size to content), expanded for
`colSpan`. When a `repeat`/`conditional` wraps an element that also has the other, the
`conditional` is outermost (gate, then repeat).

## Binding namespace

Paths available to templates:

```
company.*    name, gstin, addressLine1/2, city, state, stateCode, pincode, country,
             phone, email, logo, signature, upiId, qr, bankName, accountNumber, ifsc
customer.*   name, gstin, phone, email, addressLine1/2, city, state, stateCode, pincode
invoice.*    number, date, dueDate, currency, subtotal, tax, discount, total, notes, status
items[]      description, hsnSac, quantity, unitPrice, taxRate, amount
payment.*    upi, qr, bankName, accountNumber, ifsc
signature.url
```

The concrete data the client binds these against comes from the invoice and its company/customer
**snapshots** (captured at issue time), so an invoice re-renders identically forever.

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
