/**
 * Pure verification of the Phase 3 validation/parse layer — no DB, no server. Exercises the
 * exact functions the review found bugs in, so each fix has a standing regression check.
 *
 * Run: npx ts-node src/scripts/checkPhase3Validation.ts  (or npm run check:phase3v)
 */
import { AppError } from "../common/errors/AppError";
import { optionalDecimalString } from "../common/validation";
import { isValidGstin, reconcileStateCode } from "../common/gstin";
import { parseCompanyBody } from "../modules/company/dto/company.dto";
import { parseSettingsBody } from "../modules/settings/dto/settings.dto";
import { parseCreateCustomerBody, parsePatchCustomerBody } from "../modules/customer/dto/customer.dto";

let passed = 0;
let failed = 0;
const ok = (label: string, cond: boolean, detail = ""): void => {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};
// Assert a call throws a 400 BadRequest.
const throws400 = (label: string, fn: () => unknown): void => {
  try {
    fn();
    ok(label, false, "expected a 400 but nothing was thrown");
  } catch (e) {
    ok(label, e instanceof AppError && e.statusCode === 400, `threw ${(e as Error).message}`);
  }
};

const GSTIN_27 = "27AAPFU0939F1ZV"; // valid, Maharashtra (state 27)

console.log("\nHIGH — defaultTaxPercent round-trip: write accepts the string the read emits");
ok('number 18 -> "18"', optionalDecimalString(18, "t") === "18");
ok('string "18" -> "18" (the GET-then-PUT case)', optionalDecimalString("18", "t") === "18");
ok('string "2.5" preserved exactly', optionalDecimalString("2.5", "t") === "2.5");
ok("null -> null", optionalDecimalString(null, "t") === null);
ok("undefined -> undefined", optionalDecimalString(undefined, "t") === undefined);
ok('empty string -> null', optionalDecimalString("   ", "t") === null);
throws400("150 rejected (max 100)", () => optionalDecimalString(150, "t", { max: 100 }));
throws400('"abc" rejected', () => optionalDecimalString("abc", "t"));
throws400('"1e5" exponent rejected', () => optionalDecimalString("1e5", "t"));
throws400("object rejected", () => optionalDecimalString({}, "t"));

console.log("\nLOW — GSTIN shape now rejects out-of-range state codes 00 / 39");
ok("valid 27-prefix GSTIN still accepted", isValidGstin(GSTIN_27) === true);
ok('"00…" prefix rejected regardless of checksum', isValidGstin("00AAAAA0000A1ZI") === false);
ok('"39…" prefix rejected regardless of checksum', isValidGstin("39AAPFU0939F1ZV") === false);

console.log("\nMEDIUM — GSTIN/stateCode reconciliation (can never disagree)");
ok("GSTIN present, stateCode omitted -> derived 27", reconcileStateCode(GSTIN_27, undefined) === "27");
ok("GSTIN present, matching stateCode 27 -> 27", reconcileStateCode(GSTIN_27, "27") === "27");
throws400("GSTIN 27 + conflicting stateCode 29 -> 400", () => reconcileStateCode(GSTIN_27, "29"));
ok("no GSTIN, stateCode 29 passes through", reconcileStateCode(null, "29") === "29");

console.log("\nMEDIUM — company/customer parse enforce the reconciliation");
ok(
  "company: gstin only derives stateCode 27",
  parseCompanyBody({ name: "Acme", gstin: GSTIN_27 }).stateCode === "27"
);
throws400("company: gstin + wrong stateCode -> 400", () =>
  parseCompanyBody({ name: "Acme", gstin: GSTIN_27, stateCode: "29" })
);
ok(
  "customer create: gstin only derives stateCode 27",
  parseCreateCustomerBody({ name: "Bob", gstin: GSTIN_27 }).stateCode === "27"
);
throws400("customer create: gstin + wrong stateCode -> 400", () =>
  parseCreateCustomerBody({ name: "Bob", gstin: GSTIN_27, stateCode: "29" })
);

console.log("\nMEDIUM — customer PATCH parse validates shapes, defers cross-reconcile to service");
{
  const p = parsePatchCustomerBody({ name: "Renamed" });
  ok("PATCH {name} sets only name (no gstin/stateCode keys)", "name" in p && !("gstin" in p) && !("stateCode" in p));
  const p2 = parsePatchCustomerBody({ stateCode: "29" });
  ok("PATCH {stateCode} sets stateCode without forcing gstin", p2.stateCode === "29" && !("gstin" in p2));
  throws400("PATCH invalid gstin -> 400", () => parsePatchCustomerBody({ gstin: "BADGSTIN" }));
}

console.log("\nHIGH/LOW — settings PUT is now a MERGE: omitted keys are absent (no wipe)");
{
  const only = parseSettingsBody({ defaultCurrency: "usd" });
  ok('PUT {defaultCurrency} -> currency upper-cased, ONLY that key present', only.defaultCurrency === "USD" && Object.keys(only).length === 1);
  ok("nextInvoiceNumber NOT in payload when omitted (counter can't be wiped)", !("nextInvoiceNumber" in only));
  const tax = parseSettingsBody({ defaultTaxPercent: "18" });
  ok('PUT {defaultTaxPercent:"18"} accepted as string -> "18"', tax.defaultTaxPercent === "18" && Object.keys(tax).length === 1);
  const empty = parseSettingsBody({});
  ok("PUT {} yields an empty merge (no-op)", Object.keys(empty).length === 0);
  const clear = parseSettingsBody({ nextInvoiceNumber: null });
  ok("explicit null still clears (present key, null value)", "nextInvoiceNumber" in clear && clear.nextInvoiceNumber === null);
  throws400("nextInvoiceNumber 2.5 rejected (non-integer)", () => parseSettingsBody({ nextInvoiceNumber: 2.5 }));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
