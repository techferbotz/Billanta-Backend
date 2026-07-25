# Money & Calculation Spec

This is the exact algorithm `src/common/money.ts` implements. The Android client MUST reproduce
it byte-for-byte so its offline totals match what the server stores. **The server always
recomputes totals from the items and stores its own result; client-sent totals are advisory.**

## Representation

- **All money is an integer number of paise** (minor units). Never a float, anywhere — not in
  storage, not on the wire, not in intermediate math. Over the wire, money is a **decimal string**
  of paise (e.g. `"531000"` = ₹5,310.00). In the database it is a `BigInt` column.
- **Quantity** and **tax rate percent** are decimals, sent as strings (e.g. `"2.5"`, `"18"`).
- **Unit price** is an integer number of paise.
- Intermediate arithmetic uses **exact decimal** (`decimal.js`); the final of each step is
  **rounded HALF-UP** (ties away from zero) to a whole paise.

Bounds: each paise value must be ≤ `Number.MAX_SAFE_INTEGER` (~₹90 trillion); the server rejects
larger inputs and aggregate totals.

## Inputs

```
item      = { quantity: string, unitPrice: number(paise), taxRatePercent: string }
discount  = { type: "Flat" | "Percentage", value: string } | none
           # Percentage: value is the percent. Flat: value is an amount in PAISE.
options   = { discountBeforeTax: boolean }   # chosen per invoice
```

## Algorithm

### Step 1 — line amounts (both modes)

For each line: `lineTotal = roundHalfUp(quantity × unitPrice)` (paise).
`subtotal = Σ lineTotal`.

### Step 2 — discount total

Compute against a **base** that depends on the mode (below), then **clamp to `[0, base]`**:

- `Percentage`: `roundHalfUp(base × value / 100)`
- `Flat`: `roundHalfUp(value)` (value is already paise)

### Mode A — discount **before** tax (GST-correct; `discountBeforeTax = true`)

Base for the discount is `subtotal`.

1. `discountTotal = clamp(discountAmount(subtotal), 0, subtotal)`.
2. **Apportion** `discountTotal` across lines pro-rata by `lineTotal`, using cumulative
   largest-remainder so the pieces sum **exactly** to `discountTotal` and each is in
   `[0, lineTotal]`:
   ```
   cumAmount = 0 ; prevCum = 0
   for each line i:
     cumAmount += lineTotal[i]
     cumDiscount = roundHalfUp(discountTotal × cumAmount / subtotal)
     lineDiscount[i] = cumDiscount − prevCum
     prevCum = cumDiscount
   ```
3. For each line: `taxable = lineTotal[i] − lineDiscount[i]` (in `[0, lineTotal]`);
   `taxAmount[i] = roundHalfUp(taxable × taxRatePercent[i] / 100)`.
4. `taxTotal = Σ taxAmount`.
5. `grandTotal = subtotal − discountTotal + taxTotal`.

### Mode B — discount **after** tax (`discountBeforeTax = false`)

1. For each line: `taxAmount[i] = roundHalfUp(lineTotal[i] × taxRatePercent[i] / 100)` (tax on the
   full line, no discount).
2. `taxTotal = Σ taxAmount`.
3. Base for the discount is `subtotal + taxTotal`.
   `discountTotal = clamp(discountAmount(subtotal + taxTotal), 0, subtotal + taxTotal)`.
4. `grandTotal = subtotal + taxTotal − discountTotal`.

> Note: for a percentage discount with a uniform tax rate the two modes yield the same
> `grandTotal` (multiplication commutes), but the **tax shown differs** — Mode A taxes the
> discounted value (correct for a GST invoice), Mode B taxes the full value. Mode A is the default.

### What is stored per line vs per invoice

- Per **InvoiceItem**: `lineTotal` (= quantity × unitPrice, pre-discount, pre-tax) and `taxAmount`.
- Per **Invoice**: `subtotal`, `discountTotal`, `taxTotal`, `grandTotal`. The apportioned per-line
  discount is an internal calculation detail and is not stored separately.

## GST split (presentation only — derived, never stored)

Only the total tax is stored. The CGST+SGST vs IGST split is derived at display time from the
seller's and buyer's 2-digit state codes (taken from the invoice's company/customer snapshots):

- **Same state** (intra-state): `cgst = floor(taxTotal / 2)`, `sgst = taxTotal − cgst`
  (an odd single paise goes to SGST so the two still sum to `taxTotal`), `igst = 0`.
- **Different or unknown state** (inter-state): `cgst = sgst = 0`, `igst = taxTotal`.

## Worked examples (all values in paise)

**Basic** — 2 × ₹10.00 (unitPrice 1000) @ 18%:
`lineTotal 2000`, `tax 360`, `subtotal 2000`, `grand 2360`.

**Before-tax 10% discount** — lines ₹10 (1000) and ₹40 (4000), subtotal 5000, 18% tax:
discount `500`, apportioned `100 / 400`, taxable `900 / 3600`, tax `162 / 648`,
`taxTotal 810`, `grandTotal = 5000 − 500 + 810 = 5310`. Intra-state split: `cgst 405, sgst 405`.

**After-tax 10% discount** — same lines (1000 & 4000): tax on the full lines `180 / 720`,
`taxTotal 900`; discount base `subtotal + taxTotal = 5900`, `discount = round(5900 × 10%) = 590`,
`grandTotal = 5900 − 590 = 5310`. Same **grandTotal** (5310) as before-tax, but a different
**taxTotal** (900 vs 810) — the whole point of the toggle is the tax figure on the invoice.

**Half-up** — 1 unit @ unitPrice 1 paise, 50% tax: taxable 1, `tax = roundHalfUp(0.5) = 1`.

**Apportionment never overshoots** — 4 lines of 1 paise each, Flat discount 2, before tax:
cumulative shares `1, 0, 1, 0` (sum 2); taxable `0, 1, 0, 1` — no line's taxable ever exceeds its
1-paise amount. (A naive "last line absorbs the residual" scheme would produce `1,1,1,−1` and a
taxable of 2 on the last line — the bug this design avoids.)

These examples are encoded as assertions in `src/scripts/checkMoney.ts` (`npm run check:money`).
