---
name: new-invoice-template
description: >-
  Generate a production-quality Billanta invoice template — from a short text brief OR by reproducing
  a reference invoice the user supplies as a PDF or image — and publish it live via the admin API. Use
  when the user wants to create, generate, design, add, or REPRODUCE an invoice template (e.g.
  "/new-invoice-template modern, teal accent, premium", "make a template like this invoice.pdf",
  "recreate this invoice as a template"). Reads a reference invoice, identifies its sections
  (billed-from / billed-to, items, totals, payment, bank, notes, terms, …), decides which are hidable
  and which colours are theme-changeable, then produces HTML+CSS in Billanta's compiler subset,
  hard-verifies it compiles and is fully themed, and publishes it. NOT for editing app UI/screens, and
  NOT for the app-side render code — this is the backend template pipeline only.
---

# New invoice template

Generate a **production-quality** Billanta invoice template and publish it live — either from a text
**brief** or by **reproducing a reference invoice** (a PDF or image the user provides).

The output is authored **HTML + CSS** in Billanta's strict compiler subset. The backend compiles it
to Billanta Template JSON; the Android app renders that JSON and **never** renders HTML — so HTML/CSS
here is an *authoring language*, not a runtime. A template you generate MUST:

1. **Compile cleanly** through the real compiler (anything outside the subset is rejected).
2. Be **fully themed** — every element drawn in a theme colour is tokenised, so a user's colour
   override never leaves a stray element behind (this is a hard, verified gate).
3. Expose the **sections** (with `edits`), **empty-state placeholders**, and optional
   **customisation** the app's section editor is built on.

**Never publish a template that has not passed `verifyTemplate.ts` (Step 4).**

---

## Step 0 — The input: a brief, or a reference invoice

The skill takes EITHER:

- **A text brief** — infer sensible defaults for anything unstated and say what you chose; don't block.

  | input | notes |
  | --- | --- |
  | style / vibe | "modern minimalist", "classic corporate", "bold coloured header", "elegant serif"… |
  | accent colour | one brand hex. Used purposefully (header fill, or title + the totals rule) — not everywhere. |
  | free / **premium** | premium templates are gated (only premium users can download the tree). Default free. |
  | name + slug | display name ("Coastal") + lowercase slug (`coastal`, `a-z 0-9 -`). Derive if unstated. |
  | category | "Business", "Minimal", "Premium", … |

- **A reference invoice** — a PDF or image to reproduce as a themeable template. Do **Step 0b** first,
  then design from the plan it produces. (Still infer name/slug/category and free-vs-premium as above —
  ask only if the user cares.)

## Step 0b — Analyse a reference invoice (only when given a PDF or image)

**Read it.** Use the Read tool on the file path — it renders images directly, and PDF pages via the
`pages` parameter (an invoice is 1–2 pages). If the user pasted the image into the chat, analyse it in
place. Study the WHOLE invoice: layout, every block, the colours, the type.

Then produce a short **reconstruction plan** and show it to the user before authoring — this publishes
live, so a reproduction gets a quick confirmation first.

**1. Layout & type.** One- or two-column header? Boxed or borderless item table? Totals in a right-hand
panel or the table footer? Which of the five bundled fonts (Inter, Roboto, Open Sans, Lato, Montserrat)
is closest to the reference's face? You are reproducing the **structure and feel within the compiler
subset**, not pixel-copying: anything unsupported (gradients, background images, icons, multiple
typefaces, absolute positioning, watermarks) is simplified to the nearest supported equivalent or
dropped.

**2. Sections — map every block to a Billanta section id.** The id decides the editor it opens and
**whether it can be hidden** (you don't choose hidability freely — it follows the id):

  | reference block (any wording) | `data-section` | edits | hidable |
  | --- | --- | --- | --- |
  | seller — "From" / "Billed From" / logo + company at top, with the invoice no./date/due | `header` | invoiceDetails | no |
  | buyer — "Bill To" / "Billed To" / "Ship To" / customer | `parties` | customer | no |
  | the line-item table | `items` | items | no |
  | subtotal / tax / grand total | `totals` | discount | no |
  | "Payment" / UPI / "Pay to" / **bank account** (A/C no., IFSC) | `payment` | company | **yes** |
  | "Notes" / remarks | `notes` | notes | **yes** |
  | signature / "Authorised signatory" | `signature` | company | **yes** |
  | "Terms" / "Terms & Conditions" | `terms` | none | **yes** |

  - Tag each top-level block `data-section="<id>"`. Structural blocks (header, parties, items, totals)
    are never hidable; the optional ones (payment, notes, signature, terms) are.
  - **Bank details live inside `payment`** — don't invent a new section for them.
  - If the totals sit in the item-table footer, tag the grand-total `<tr>` `data-section="totals"`.
  - The **invoice-number structure** (e.g. "INV-2025-014") is DATA, not markup — bind it as
    `{{ invoice.number }}`; the prefix/sequence is the user's `Settings`, never hard-coded in the
    template. Same for date/due (`{{ invoice.date | date }}`, `{{ invoice.dueDate | date }}`).

**3. Dynamic colours — decide what to tokenise.** Pick the reference's **brand** colour(s) — the header
fill, the title, the table-header fill, the rule above the totals, section headings — and make those a
`theme` token: `accent` at minimum, plus `secondary` if the invoice clearly uses two brand colours.
Sample an approximate hex from the image. **Do NOT tokenise body ink or greys** — leave readable text a
fixed colour so a user's override can never make the invoice unreadable. In the plan, list each colour
you'll tokenise and which element carries it.

**4. Optional fields → conditionals.** Anything that can be absent — GSTIN, due date, a discount line,
notes, the bank block, the whole payment block — gate with `data-if`, and pair each with a
`data-unless` editor-only empty state (Step 3b). This is how "which fields/sections are optional"
becomes real behaviour rather than a guess.

**5. Data → bindings.** Replace EVERY literal value in the reference (company name, address, the item
rows, the amounts, the invoice number) with a binding from the namespace in Step 2. A reconstructed
template must contain **none** of the sample invoice's real data — only bindings.

## Step 1 — Design a real invoice (production quality)

If you analysed a reference (Step 0b), **reproduce its plan** — its layout, section map, fonts and
tokenised colours; otherwise **design fresh** from the brief. Either way it's a real invoice, not a
demo — compose, top to bottom:

- **Header** — company logo (`<img src="{{ company.logo }}">`), name, GSTIN, and the invoice
  number / date / due date.
- **Bill to** — the customer block.
- **Line-item table** — description, qty, rate, amount, as a single `data-repeat` row.
- **Totals** — subtotal, tax, and a bold grand total.
- Optional: **payment** (UPI / bank), **notes**, **signature**.

The app creates an invoice **empty** and fills it section by section, so a production template should
also carry an **empty-state placeholder** for each editable section (Step 3b) — shown only in the
editor while that section has no data yet.

Indian invoicing conventions: ₹, GST, HSN/SAC. Design: clear hierarchy, generous whitespace, numbers
right-aligned, 9–11pt body with a larger title, one accent used with restraint. Lay out with
**flexbox** (`display:flex`), never floats or positioning. Study the three shipped templates for the
house style — `src/templates/seed/seedTemplates.ts` (classic / minimal / bold).

## Step 2 — Author HTML + CSS in the subset

**Tags:** `div span p h1`–`h6 table thead tbody tfoot tr td th img hr br strong em ul ol li`. Nothing
else (no `script/style/svg/form`, no `on*` handlers). One **root** element carries `data-page-size="A4"`;
its `padding` becomes the page margin and its `font-family`/`font-size` the document defaults.
`<img src>` must be exactly one binding (no external URLs, no `?? fallback`). `<td>/<th>` may set
`colspan` (1–64).

**CSS properties:** `display(flex|block|none) flex-direction justify-content align-items flex-wrap gap
flex padding[-*] margin[-*] width height min-*/max-* border[-*] border-radius background background-color
color font-size font-weight font-style font-family line-height text-align text-transform letter-spacing
overflow vertical-align opacity`. **Rejected:** animations/transitions/transforms/filters, `float`,
`position`, media queries, pseudo-classes/elements, `calc()`, `url(...)`, `*`, attribute/sibling selectors.
**Selectors:** tag, `.class`, `#id`, descendant, `>` child, comma lists.
**Units:** `px`(→pt ×0.75), `pt`, `%` (width/height/min/max/margin), `auto`. No `em/rem/vw/vh/calc`.
**Fonts:** only **Inter, Roboto, Open Sans, Lato, Montserrat** (or `sans-serif`→Inter).
**Colours:** hex / `rgb()` / named — all normalised to hex.

**Bindings** — `{{ path }}`, `{{ path | currency|date|number }}`, `{{ path ?? 'fallback' }}`:
```
company.*   name gstin addressLine1/2 city state stateCode pincode country phone email logo signature upiId qr bankName accountNumber ifsc
customer.*  name gstin phone email addressLine1/2 city state stateCode pincode
invoice.*   number date dueDate currency subtotal tax discount total notes status
items[]     description hsnSac quantity unitPrice taxRate amount
payment.*   upi qr bankName accountNumber ifsc
signature.* url name designation
```
**Repeat/conditional:** `data-repeat="items as item"` on the `<tbody>`'s `<tr>` (one repeat row per
table, no static rows alongside it); `data-if="payment.upi"` renders an element only when the path is
truthy; `data-unless="items"` only when it is FALSY (the two pair up for empty states — Step 3b, and an
element may not carry both); `data-editor-only` marks an element the app shows ONLY while editing and
drops from every export.

## Step 3 — Theme it fully (this is what makes it production quality)

Declare a colour token — the `accent` (and `secondary`) you identified from the reference, or the
brief's accent — and apply it to **every** element drawn in that colour, or verify will reject it.

- **Colour tokens** — tag an element `data-token="styleKey:tokenName"` (declare `accent` at minimum).
  The token's default colour is read from that element's resolved style, so tag an element that
  actually has the colour.
  - `color` is **inherited**: tokenise it on a container (e.g. the root, or a block) and the compiler
    **propagates** the token to every text node that draws that colour automatically. So to theme all
    body text, put `data-token="color:accent"` on the root; to theme just a heading, set that heading's
    `color` to the accent and tag it.
  - `backgroundColor` and `border*Color` are **not** inherited — tag **each** element that uses the
    accent (every header cell's `data-token="backgroundColor:accent"`, the totals rule's
    `data-token="borderTopColor:accent"`, etc.). Missing one = a straggler that verify will catch.
  - Rule of thumb: **if two elements share the accent colour and you tag one but not the other, that
    is a bug.** Either tag both or make one a non-token colour.
- **Named sections** — tag each top-level block `data-section="<id>"`. Vocabulary (also fixes the
  editor label + what it edits): `header`(invoice details) · `parties`(customer) · `items` ·
  `totals`(discount) · `payment`(company) · `notes` · `signature`(company) · `terms`. Use the subset a
  template actually has. If the totals live in a table `<tfoot>`, tag the grand-total `<tr>`
  `data-section="totals"` so the discount is reachable from the editor. `edits` is emitted
  automatically from the vocab — you don't author it.
- **Customisation sheet** (optional) — put `data-customisation='[…]'` (valid JSON) on the root to
  state the edit-sheet order/labels explicitly, e.g.
  `[{"type":"template","title":"Template"},{"type":"color","title":"Brand colour","token":"accent"},{"type":"section","title":"Payment","section":"payment"}]`.
  Omit it to let the app synthesise the sheet from tokens + sections.

## Step 3b — Empty states (support the app's section editor)

The app creates an invoice empty and fills it section by section; wherever a section has no data yet it
shows a "tap to add" placeholder. Let the **template** own that placeholder so it's styled to match the
rest of the design — otherwise the app falls back to a generic dashed box.

Pattern: inside a section wrapper, pair the real content (`data-if`) with a dashed, **editor-only**
placeholder (`data-unless`) on the same binding:

```html
<div class="itemsblock" data-section="items">
  <table class="items" data-if="items"> … the real items table … </table>
  <div class="empty" data-unless="items" data-editor-only><div class="emptylabel">+ Add an item</div></div>
</div>
```
```css
.empty { margin-top: 18px; padding: 22px; border: 1.5pt dashed #94a3b8; border-radius: 8px; text-align: center; }
.emptylabel { color: #94a3b8; font-size: 10pt; }
```

Rules that matter:
- `data-editor-only` is a **hard guarantee** — the app renders that node only while editing and drops
  it from every export (PDF/PNG/JPEG), so it never prints on a real invoice. Only put it on placeholders.
- The placeholder must compile to a **box**, so it draws its own dashed border: give it a **block child**
  (e.g. a nested `<div>` around the label). A bare text `<div>Add…</div>` becomes a text node whose
  border the renderer leaves to its parent — the dash won't show. `verifyTemplate` can't catch this; it
  is on you.
- Give the dashed border a **non-token** colour (a neutral grey). If you dash it in the accent colour,
  tokenise every border side or verify flags a straggler.
- Key emptiness on a real binding: `items`, `customer.name`, `invoice.notes`, `payment.upi`, …
- Add one for each **editable** section you want styled (`parties`, `items`, `notes`, `payment`, …).
  Any section you skip still works (the app synthesises a fallback). `classic` in the seed file is the
  worked example (its items section).

## Step 4 — Verify (HARD GATE — never skip, never publish without a PASS)

Write the HTML and CSS to two files (use the scratchpad dir), then:

```bash
npx ts-node src/scripts/verifyTemplate.ts <html-file> <css-file>
```

It prints the theme/sections(+edits)/customisation it found, then **PASS** or **FAIL**. On FAIL:
- `COMPILE FAILED: …` — the exact phase, token, and source line. Fix that and re-run.
- `N colour straggler(s)` — an element drawn in a token's colour isn't tokenised (Step 3). Tag it,
  make its colour inherit-propagate, or give it a non-token colour. Re-run until 0.

Only proceed to publish on **PASS**.

## Step 5 — Visual QA (recommended)

The compiler guarantees structure, not taste. To eyeball the design, build a quick preview: copy the
HTML, replace each `{{ binding }}` with a realistic sample value, expand the `data-repeat` row into
~3 sample line items, inline the CSS in a `<style>` block, and open it in the Browser pane. Confirm it
reads like a professional invoice before publishing. (This is an approximation — the app's renderer is
the source of truth — but it catches layout/spacing/colour mistakes.)

## Step 6 — Publish live (admin API)

Fetch the admin key from the server `.env` into a transient env var (don't print it), then publish.
On Windows PowerShell:

```powershell
$keyPath = "C:\Users\dhoni\Documents\HouseOfApps\AuraPix\aurapix-ec2-key.pem"
$env:ADMIN_API_KEY = (ssh -i $keyPath -o BatchMode=yes ubuntu@13.205.128.80 "grep -m1 '^ADMIN_API_KEY=' /opt/apps/billanta/Billanta-Backend/.env | cut -d= -f2-").Trim()
npx ts-node src/scripts/publishTemplate.ts --id <slug> --name "<Name>" --category "<Category>" <--premium if premium> --base https://billanta.ferbotz.com --html <html-file> --css <css-file>
Remove-Item Env:\ADMIN_API_KEY
```

`publishTemplate.ts` creates the template (or adds a version if the slug exists), the server
**re-compiles** it (a bad template is a 400 with the located message — but Step 4 should have caught
that), and publishes it as the current, immutable version the app serves.

## Step 7 — Confirm it's live

```bash
curl -s https://billanta.ferbotz.com/templates/<slug>/compiled | head -c 400
```
Confirm it returns the compiled tree (or a 403 `PREMIUM_REQUIRED` for a premium template fetched
anonymously — that's expected and correct). Report the slug, version, free/premium, and that it now
appears in `GET /templates`.

## Guardrails

- Never skip Step 4; never publish a FAIL.
- Never invent bindings outside the namespace, or CSS/tags outside the subset — they'll be rejected.
- The admin key is a secret: fetch it into an env var, never echo it or write it to a file.
- Publishing makes the template **immediately visible** to app users. If the brief is experimental,
  offer to publish it as `--premium` (gated) or to stop at Step 5 for review.
- **Reproducing a reference:** show the Step 0b reconstruction plan AND the Step 5 preview and get a
  quick nod before publishing — a reproduction is easy to get subtly wrong, and it goes live. Never
  carry over the sample invoice's real data, and never copy unsupported visuals literally.
