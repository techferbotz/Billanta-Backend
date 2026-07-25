import Decimal from "decimal.js";

// THE money & calculation module. Nothing else in the codebase computes invoice totals.
//
// Rules this file guarantees (mirrored in docs/MONEY.md so the Android client reproduces them
// byte-for-byte):
//   - Money is INTEGER PAISE (minor units). Never a float anywhere.
//   - Intermediate arithmetic uses exact decimal (decimal.js) — quantities and tax rates are
//     decimals, prices are integer paise — and every monetary result is rounded HALF-UP to a
//     whole paise.
//   - Rounding happens at each LINE, then once more for each derived total. The order of
//     operations is fixed and documented per branch below.
//   - Two discount orderings are supported and chosen per invoice (`discountBeforeTax`):
//       before-tax : discount is apportioned pro-rata across lines and removed from each line's
//                    taxable value BEFORE tax — the GST-correct treatment (s.15(3) CGST).
//       after-tax  : tax is computed on the full lines, then the discount comes off the
//                    post-tax total.
//
// All returned values are integer paise as JS numbers. They are guaranteed to be safe integers
// for any realistic invoice (a value would need to exceed ₹90 trillion to leave the safe
// range); the repository widens them to BigInt for storage.

const HALF_UP = Decimal.ROUND_HALF_UP;

// Round a decimal amount of paise to a whole paise, half-up, and return a JS integer.
const roundPaise = (d: Decimal): number => Number(d.toDecimalPlaces(0, HALF_UP).toFixed(0));

export interface MoneyLineInput {
  quantity: string; // decimal string, e.g. "2.5"
  unitPrice: number; // integer paise, >= 0
  taxRatePercent: string; // decimal string, e.g. "18" or "12.5"
}

export type DiscountKind = "Flat" | "Percentage";

export interface MoneyDiscountInput {
  type: DiscountKind;
  // Flat: the amount in PAISE (integer, as a string). Percentage: the percent (e.g. "10").
  value: string;
}

export interface MoneyOptions {
  discountBeforeTax: boolean;
}

export interface MoneyLineResult {
  lineTotal: number; // paise: round(quantity × unitPrice), pre-discount, pre-tax
  taxAmount: number; // paise: this line's tax
}

export interface InvoiceCalculation {
  lines: MoneyLineResult[];
  subtotal: number; // paise: Σ lineTotal
  discountTotal: number; // paise
  taxTotal: number; // paise: Σ line taxAmount
  grandTotal: number; // paise
}

// Line extended amount = quantity × unitPrice, rounded to whole paise.
const lineAmountOf = (line: MoneyLineInput): number =>
  roundPaise(new Decimal(line.quantity).times(line.unitPrice));

// Percentage of a base, or a flat paise amount — clamped to [0, base] so a discount can never
// exceed what it applies to or go negative.
const discountAmount = (
  discount: MoneyDiscountInput,
  base: number
): number => {
  let raw: number;
  if (discount.type === "Percentage") {
    raw = roundPaise(new Decimal(base).times(discount.value).dividedBy(100));
  } else {
    // Flat value is already paise; round in case a fractional string slipped through.
    raw = roundPaise(new Decimal(discount.value));
  }
  return Math.max(0, Math.min(raw, base));
};

/**
 * Apportion a discount total across lines pro-rata by line amount, so the per-line pieces sum
 * to EXACTLY `discountTotal` AND every piece stays in [0, lineAmount].
 *
 * Uses CUMULATIVE largest-remainder allocation: each line's share is the rounded cumulative
 * discount up to and including it, minus the rounded cumulative discount up to the previous
 * line. Because the cumulative target is monotonic non-decreasing and its final value rounds to
 * exactly `discountTotal`, the shares sum exactly and are each non-negative — and because a
 * line's exact share never exceeds its own amount, no share overshoots the line. (A naive "last
 * line absorbs the residual" scheme can push the last share negative, inflating that line's
 * taxable value above its amount — the bug this replaces.)
 */
const apportion = (discountTotal: number, lineAmounts: number[], subtotal: number): number[] => {
  if (discountTotal === 0 || subtotal === 0) return lineAmounts.map(() => 0);
  const out: number[] = [];
  let cumAmount = 0;
  let prevCumDiscount = 0;
  for (let i = 0; i < lineAmounts.length; i++) {
    cumAmount += lineAmounts[i];
    const cumDiscount = roundPaise(new Decimal(discountTotal).times(cumAmount).dividedBy(subtotal));
    out.push(cumDiscount - prevCumDiscount);
    prevCumDiscount = cumDiscount;
  }
  return out;
};

const taxOf = (taxableAmount: number, taxRatePercent: string): number =>
  roundPaise(new Decimal(taxableAmount).times(taxRatePercent).dividedBy(100));

/**
 * Compute an invoice's line results and totals from its items and (optional) discount.
 * This is the ONLY source of truth for money — the server calls it and stores its result,
 * treating any client-sent totals as advisory.
 */
export const calculateInvoice = (
  items: MoneyLineInput[],
  discount: MoneyDiscountInput | null,
  options: MoneyOptions
): InvoiceCalculation => {
  const lineAmounts = items.map(lineAmountOf);
  const subtotal = lineAmounts.reduce((a, b) => a + b, 0);

  if (options.discountBeforeTax) {
    // --- before-tax: discount reduces each line's taxable value, THEN tax --------------
    const discountTotal = discount ? discountAmount(discount, subtotal) : 0;
    const lineDiscounts = apportion(discountTotal, lineAmounts, subtotal);

    const lines: MoneyLineResult[] = items.map((item, i) => {
      // apportion() guarantees 0 <= lineDiscount <= lineAmount, so taxable is already in
      // [0, lineAmount]; clamp anyway so tax can never be computed on an out-of-range base.
      const taxable = Math.max(0, Math.min(lineAmounts[i], lineAmounts[i] - lineDiscounts[i]));
      return { lineTotal: lineAmounts[i], taxAmount: taxOf(taxable, item.taxRatePercent) };
    });
    const taxTotal = lines.reduce((a, l) => a + l.taxAmount, 0);
    const grandTotal = subtotal - discountTotal + taxTotal;
    return { lines, subtotal, discountTotal, taxTotal, grandTotal };
  }

  // --- after-tax: tax on the full lines, THEN discount off the post-tax total -----------
  const lines: MoneyLineResult[] = items.map((item, i) => ({
    lineTotal: lineAmounts[i],
    taxAmount: taxOf(lineAmounts[i], item.taxRatePercent),
  }));
  const taxTotal = lines.reduce((a, l) => a + l.taxAmount, 0);
  const postTax = subtotal + taxTotal;
  const discountTotal = discount ? discountAmount(discount, postTax) : 0;
  const grandTotal = postTax - discountTotal;
  return { lines, subtotal, discountTotal, taxTotal, grandTotal };
};

// --- GST split (presentation only) ----------------------------------------------------
export interface GstSplit {
  intraState: boolean;
  cgst: number; // paise
  sgst: number; // paise
  igst: number; // paise
}

/**
 * Derive the CGST+SGST vs IGST split from the seller's and buyer's state codes. This is a
 * PRESENTATION concern derived from the stored total tax — nothing here is persisted.
 *
 * Same state -> CGST + SGST (two equal halves; an odd single paise goes to SGST so the two
 * still sum to the total). Different (or unknown) states -> a single IGST equal to the total.
 */
export const deriveGstSplit = (
  taxTotal: number,
  sellerStateCode: string | null | undefined,
  buyerStateCode: string | null | undefined
): GstSplit => {
  const intraState = Boolean(sellerStateCode && buyerStateCode && sellerStateCode === buyerStateCode);
  if (intraState) {
    const cgst = Math.floor(taxTotal / 2);
    return { intraState: true, cgst, sgst: taxTotal - cgst, igst: 0 };
  }
  return { intraState: false, cgst: 0, sgst: 0, igst: taxTotal };
};
