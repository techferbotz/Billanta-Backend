/**
 * Exact rounding/calculation fixtures for src/common/money.ts. No DB, no server.
 * Run: npx ts-node src/scripts/checkMoney.ts   (or npm run check:money)
 *
 * Every expected value below is hand-computed in paise. If any of these ever changes, the
 * Android client's mirror is out of sync — treat a diff here as a spec change, not a test bug.
 */
import { calculateInvoice, deriveGstSplit, MoneyLineInput } from "../common/money";

let passed = 0;
let failed = 0;
const eq = (label: string, got: unknown, want: unknown): void => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.error(`  FAIL  ${label}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`); }
};

const line = (quantity: string, unitPrice: number, taxRatePercent: string): MoneyLineInput => ({
  quantity, unitPrice, taxRatePercent,
});

console.log("\nbasics");
{
  // 2 × ₹10.00 @ 18% -> line 2000, tax 360, grand 2360
  const r = calculateInvoice([line("2", 1000, "18")], null, { discountBeforeTax: true });
  eq("qty×price and 18% tax", r, { lines: [{ lineTotal: 2000, taxAmount: 360 }], subtotal: 2000, discountTotal: 0, taxTotal: 360, grandTotal: 2360 });
}
{
  // empty invoice
  const r = calculateInvoice([], null, { discountBeforeTax: true });
  eq("empty invoice is all zeros", r, { lines: [], subtotal: 0, discountTotal: 0, taxTotal: 0, grandTotal: 0 });
}

console.log("\nhalf-up rounding");
{
  // taxable 1 paise @ 50% = 0.5 -> half-up -> 1
  const r = calculateInvoice([line("1", 1, "50")], null, { discountBeforeTax: true });
  eq("0.5 paise rounds up to 1", r.taxTotal, 1);
}
{
  // 0.333 × ₹1.00 = 33.3 paise -> 33
  const r = calculateInvoice([line("0.333", 100, "0")], null, { discountBeforeTax: true });
  eq("33.3 paise line rounds to 33", r.subtotal, 33);
}
{
  // 2.5 × ₹4.01 (401 paise) = 1002.5 -> half-up -> 1003
  const r = calculateInvoice([line("2.5", 401, "0")], null, { discountBeforeTax: true });
  eq("1002.5 paise rounds up to 1003", r.subtotal, 1003);
}

console.log("\npercentage discount BEFORE tax (GST-correct)");
{
  // lines 1000, 2000 (subtotal 3000); 10% discount = 300; apportioned 100/200;
  // taxable 900/1800 @18% -> 162/324; taxTotal 486; grand 3000-300+486 = 3186
  const r = calculateInvoice([line("1", 1000, "18"), line("1", 2000, "18")], { type: "Percentage", value: "10" }, { discountBeforeTax: true });
  eq("before-tax 10% discount", r, { lines: [{ lineTotal: 1000, taxAmount: 162 }, { lineTotal: 2000, taxAmount: 324 }], subtotal: 3000, discountTotal: 300, taxTotal: 486, grandTotal: 3186 });
}

{
  // The Phase 5 pipeline fixture: lines 1000 & 4000 (subtotal 5000), 10% before tax.
  // apportion 100/400; taxable 900/3600 @18% -> 162/648; taxTotal 810; grand 5310.
  const r = calculateInvoice([line("1", 1000, "18"), line("2", 2000, "18")], { type: "Percentage", value: "10" }, { discountBeforeTax: true });
  eq("pipeline fixture (1000+4000, 10% before tax)", r, { lines: [{ lineTotal: 1000, taxAmount: 162 }, { lineTotal: 4000, taxAmount: 648 }], subtotal: 5000, discountTotal: 500, taxTotal: 810, grandTotal: 5310 });
}

console.log("\npercentage discount AFTER tax");
{
  // tax on full: 180/360 (taxTotal 540); postTax 3540; 10% off = 354; grand 3186
  const r = calculateInvoice([line("1", 1000, "18"), line("1", 2000, "18")], { type: "Percentage", value: "10" }, { discountBeforeTax: false });
  eq("after-tax 10% discount", r, { lines: [{ lineTotal: 1000, taxAmount: 180 }, { lineTotal: 2000, taxAmount: 360 }], subtotal: 3000, discountTotal: 354, taxTotal: 540, grandTotal: 3186 });
}
{
  // The toggle changes the TAX shown even when grand total coincides: before-tax taxTotal 486
  // vs after-tax taxTotal 540, both grand 3186.
  const before = calculateInvoice([line("1", 1000, "18"), line("1", 2000, "18")], { type: "Percentage", value: "10" }, { discountBeforeTax: true });
  const after = calculateInvoice([line("1", 1000, "18"), line("1", 2000, "18")], { type: "Percentage", value: "10" }, { discountBeforeTax: false });
  eq("toggle changes taxTotal (486 vs 540) same grand", [before.taxTotal, after.taxTotal, before.grandTotal, after.grandTotal], [486, 540, 3186, 3186]);
}

{
  // docs/MONEY.md after-tax example: lines 1000 & 4000, 18%, 10% after tax.
  // tax on full 180/720 -> taxTotal 900; base 5900; disc 590; grand 5310 (same grand as before-tax).
  const r = calculateInvoice([line("1", 1000, "18"), line("2", 2000, "18")], { type: "Percentage", value: "10" }, { discountBeforeTax: false });
  eq("MONEY.md after-tax example (1000+4000)", [r.taxTotal, r.discountTotal, r.grandTotal], [900, 590, 5310]);
}

console.log("\nflat discount + apportionment exactness");
{
  // subtotal 3000, flat ₹5.00 (500 paise) before tax; apportion 167/333 (sums to 500)
  const r = calculateInvoice([line("1", 1000, "0"), line("1", 2000, "0")], { type: "Flat", value: "500" }, { discountBeforeTax: true });
  eq("flat discount total", r.discountTotal, 500);
  eq("flat discount grand (no tax)", r.grandTotal, 2500);
}
{
  // 3 uneven lines 333/333/334 (subtotal 1000), flat 100 -> apportion 33/33/34 sums to 100
  const r = calculateInvoice([line("1", 333, "0"), line("1", 333, "0"), line("1", 334, "0")], { type: "Flat", value: "100" }, { discountBeforeTax: true });
  eq("uneven apportionment sums exactly to discount", r.discountTotal, 100);
  eq("uneven apportionment grand", r.grandTotal, 900);
}

console.log("\napportionment never overshoots a line (review regression)");
{
  // 4 lines of 1 paise each @28%, flat discount 2. The OLD 'last line absorbs residual' scheme
  // produced shares [1,1,1,-1] -> taxable [0,0,0,2] (line 4 DOUBLE its amount) -> taxTotal 1,
  // grand 3. Cumulative apportionment gives shares [1,0,1,0] -> taxable [0,1,0,1] -> taxTotal 0,
  // grand 2. No line's taxable exceeds its 1-paise amount.
  const r = calculateInvoice(
    [line("1", 1, "28"), line("1", 1, "28"), line("1", 1, "28"), line("1", 1, "28")],
    { type: "Flat", value: "2" },
    { discountBeforeTax: true }
  );
  eq("no overshoot: taxTotal 0, grand 2 (not the buggy 1/3)", [r.taxTotal, r.grandTotal, r.discountTotal], [0, 2, 2]);
  eq("every line tax is 0 (taxable never exceeds the 1-paise line)", r.lines.map((l) => l.taxAmount), [0, 0, 0, 0]);
}

console.log("\ndiscount clamping");
{
  // flat 5000 on subtotal 3000 -> clamped to 3000
  const r = calculateInvoice([line("1", 3000, "0")], { type: "Flat", value: "5000" }, { discountBeforeTax: true });
  eq("flat discount clamped to subtotal", r.discountTotal, 3000);
  eq("clamped grand is zero", r.grandTotal, 0);
}

console.log("\nGST split (derived, presentation only)");
eq("intra-state even tax -> equal halves", deriveGstSplit(486, "27", "27"), { intraState: true, cgst: 243, sgst: 243, igst: 0 });
eq("intra-state odd tax -> odd paise to sgst", deriveGstSplit(487, "27", "27"), { intraState: true, cgst: 243, sgst: 244, igst: 0 });
eq("inter-state -> single igst", deriveGstSplit(487, "27", "29"), { intraState: false, cgst: 0, sgst: 0, igst: 487 });
eq("unknown buyer state -> igst", deriveGstSplit(487, "27", null), { intraState: false, cgst: 0, sgst: 0, igst: 487 });

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
