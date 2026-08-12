---
name: new-invoice-template
description: >-
  Generate a production-quality Billanta invoice template from a short brief and publish it live via
  the admin API. Use when the user wants to create, generate, design, or add a NEW invoice template
  (e.g. "/new-invoice-template modern, teal accent, premium", "make a new invoice template like X",
  "add a premium template"). Produces authored HTML+CSS in Billanta's compiler subset, hard-verifies
  it compiles and is fully themed, then publishes it to the running backend. NOT for editing app
  UI/screens, and NOT for the app-side render code — this is the backend template pipeline only.
---

# New invoice template

Generate a **production-quality** Billanta invoice template and publish it live.

The output is authored **HTML + CSS** in Billanta's strict compiler subset. The backend compiles it
to Billanta Template JSON; the Android app renders that JSON and **never** renders HTML — so HTML/CSS
here is an *authoring language*, not a runtime. A template you generate MUST:

1. **Compile cleanly** through the real compiler (anything outside the subset is rejected).
2. Be **fully themed** — every element drawn in a theme colour is tokenised, so a user's colour
   override never leaves a stray element behind (this is a hard, verified gate).
3. Expose the **sections** (with `edits`) and optional **customisation** the app's editor is built on.

**Never publish a template that has not passed `verifyTemplate.ts` (Step 4).**

---

## Step 0 — The brief

Infer these from the user's request; pick tasteful defaults for anything unstated and say what you
chose (don't block on questions):

| input | notes |
| --- | --- |
| style / vibe | "modern minimalist", "classic corporate", "bold coloured header", "elegant serif"… |
| accent colour | one brand hex. Used purposefully (header fill, or title + the totals rule) — not everywhere. |
| free / **premium** | premium templates are gated (only premium users can download the tree). Default free. |
| name + slug | display name ("Coastal") + lowercase slug (`coastal`, `a-z 0-9 -`). Derive if unstated. |
| category | "Business", "Minimal", "Premium", … |

## Step 1 — Design a real invoice (production quality)

Not a demo. Compose, top to bottom:

- **Header** — company logo (`<img src="{{ company.logo }}">`), name, GSTIN, and the invoice
  number / date / due date.
- **Bill to** — the customer block.
- **Line-item table** — description, qty, rate, amount, as a single `data-repeat` row.
- **Totals** — subtotal, tax, and a bold grand total.
- Optional: **payment** (UPI / bank), **notes**, **signature**.

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
payment.*   upi qr bankName accountNumber ifsc      signature.url
```
**Repeat/conditional:** `data-repeat="items as item"` on the `<tbody>`'s `<tr>` (one repeat row per
table, no static rows alongside it); `data-if="payment.upi"` renders an element only when truthy.

## Step 3 — Theme it fully (this is what makes it production quality)

Declare a colour token and apply it to **every** element drawn in that colour, or verify will reject it.

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
