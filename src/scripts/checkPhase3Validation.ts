/**
 * Pure verification of the values-map validation layer (docs/FIELDS.md §7) — no DB, no server.
 * Exercises the DTO parsers of the company, settings, customer, product and invoice APIs: which
 * ids each record accepts, the wire kinds the server can check, the strictly validated money
 * inputs, and the "never block on a format" rule.
 *
 * Run: npx ts-node src/scripts/checkPhase3Validation.ts  (or npm run check:phase3v)
 */
import { AppError } from "../common/errors/AppError";
import { parseCompanyPatch, parseCompanyPut } from "../modules/company/dto/company.dto";
import { parseSettingsPatch, parseSettingsPut } from "../modules/settings/dto/settings.dto";
import { parseCustomerPatch, parseCustomerValues } from "../modules/customer/dto/customer.dto";
import { parseProductPatch, parseProductValues } from "../modules/product/dto/product.dto";
import { derivedColumnsOf, moneyInputsOf, parseInvoiceInput } from "../modules/invoice/dto/invoice.dto";
import { mergeValues } from "../fields/values";

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
// Assert a call throws a 400 BadRequest whose message mentions `includes`.
const throws400 = (label: string, fn: () => unknown, includes = ""): void => {
  try {
    fn();
    ok(label, false, "expected a 400 but nothing was thrown");
  } catch (e) {
    ok(label, e instanceof AppError && e.statusCode === 400 && e.message.includes(includes), `threw ${(e as Error).message}`);
  }
};

const IMG = { url: "https://billanta-media.s3.ap-south-1.amazonaws.com/media/u/1.webp", thumbnailUrl: "https://billanta-media.s3.ap-south-1.amazonaws.com/media/u/1_thumb.webp" };

console.log("\nwhich ids a record accepts");
ok("company accepts company_* ids", Object.keys(parseCompanyPut({ values: { company_name: "Acme", company_logo: IMG } })).length === 2);
throws400("company rejects a customer id", () => parseCompanyPut({ values: { customer_name: "Bob" } }), "customer field");
throws400("an unknown id is a 400, not silently dropped", () => parseCompanyPut({ values: { company_nmae: "Acme" } }), "not a known field id");
throws400("customer rejects a company id", () => parseCustomerValues({ values: { company_name: "Acme" } }), "company field");
throws400("settings rejects an invoice id", () => parseSettingsPut({ values: { notes: "x" } }), "invoice field");
ok("product accepts the line ids", Object.keys(parseProductValues({ values: { description: "Mug", unit_price: "15000", tax_rate: "18", image: IMG } })).length === 4);
throws400("product rejects quantity (that belongs to the line)", () => parseProductValues({ values: { quantity: "2" } }), "quantity");
throws400("values must be an object", () => parseCustomerValues({ values: ["x"] }), "JSON object");
ok("absent values -> an empty map (a blank record is allowed)", Object.keys(parseCustomerValues({})).length === 0);

console.log("\nwire kinds the server can check");
throws400("an image must be { url, thumbnailUrl }", () => parseCompanyPut({ values: { company_logo: "https://x.example/a.png" } }), "image object");
throws400("an image url must be https", () => parseCompanyPut({ values: { company_logo: { url: "http://x.example/a.png" } } }), "https");
throws400("a device-local file:// image rejected", () => parseCompanyPut({ values: { company_logo: { url: "file:///data/photo.jpg" } } }), "https");
throws400("an image object with extra keys rejected", () => parseCompanyPut({ values: { company_logo: { ...IMG, width: 4 } } }), "unknown key");
throws400("a JSON number is rejected (numbers travel as decimal strings)", () => parseSettingsPut({ values: { settings_next_invoice_number: 42 } }), "decimal string");
ok('a decimal string number is accepted', parseSettingsPut({ values: { settings_next_invoice_number: "42" } }).settings_next_invoice_number === "42");
throws400("a currency must be a 3-letter code", () => parseSettingsPut({ values: { settings_default_currency: "rupees" } }), "ISO 4217");
throws400("a state must be an indian_states code", () => parseCustomerValues({ values: { customer_state: "Karnataka" } }), "state code");
ok("a state code is accepted", parseCustomerValues({ values: { customer_state: "29" } }).customer_state === "29");
throws400("a text value over 5000 characters rejected", () => parseCustomerValues({ values: { customer_name: "a".repeat(5001) } }), "at most 5000");

console.log("\nformats never block (docs/FIELDS.md §7.1)");
ok("a GSTIN with a bad checksum is stored as typed", parseCompanyPut({ values: { company_gstin: "27AAPFU0939F1ZX" } }).company_gstin === "27AAPFU0939F1ZX");
ok("an odd phone number is stored as typed", parseCustomerValues({ values: { customer_phone: "call reception" } }).customer_phone === "call reception");

console.log("\nempty values and merges");
ok('"" and null are dropped on a replace', Object.keys(parseCompanyPut({ values: { company_name: "", company_city: null } })).length === 0);
const patch = parseCompanyPatch({ values: { company_city: null, company_name: "Acme Ltd" } });
ok("null is kept on a patch as 'clear this key'", patch.company_city === null && patch.company_name === "Acme Ltd");
const merged = mergeValues({ company_name: "Acme", company_city: "Pune", company_phone: "1" }, patch);
ok("a merge clears, replaces, and leaves absent keys alone",
  JSON.stringify(merged) === JSON.stringify({ company_name: "Acme Ltd", company_phone: "1" }), JSON.stringify(merged));
ok("settings and product patches parse the same way",
  parseSettingsPatch({ values: { settings_default_notes: null } }).settings_default_notes === null &&
    parseProductPatch({ values: { unit: null } }).unit === null);
throws400("a customer patch still checks ids", () => parseCustomerPatch({ values: { po_number: "x" } }), "invoice field");

console.log("\ninvoices: values, lines, money inputs");
const base = { templateId: "classic", templateVersion: 1 };
const inv = parseInvoiceInput({
  ...base,
  values: { invoice_number: "INV-1", company_name: "Acme", customer_name: "Bob", customer_phone: "98", po_number: "PO-7", hide_gst_column: true },
  lineItems: [{ values: { description: "Widget", quantity: "2", unit_price: "1000", tax_rate: "18" } }],
}, undefined);
ok("an invoice stores its own fields plus company and customer copies", Object.keys(inv.values).length === 6);
ok("a line without an id gets one minted", /^[0-9a-f-]{36}$/.test(inv.lines[0].lineId));
throws400("line_items is never a value", () => parseInvoiceInput({ ...base, values: { line_items: [] } }, undefined), "lineItems");
throws400("a settings id can't be stored on an invoice", () => parseInvoiceInput({ ...base, values: { settings_default_notes: "x" } }, undefined), "settings field");
throws400("a line rejects an invoice id", () => parseInvoiceInput({ ...base, lineItems: [{ values: { po_number: "x" } }] }, undefined), "invoice field");
throws400("quantity is strict: no negatives", () => parseInvoiceInput({ ...base, lineItems: [{ values: { quantity: "-1" } }] }, undefined), "at least 0");
throws400("unit_price is strict: whole paise", () => parseInvoiceInput({ ...base, lineItems: [{ values: { unit_price: "10.50" } }] }, undefined), "paise");
throws400("tax_rate is strict: 0–100", () => parseInvoiceInput({ ...base, lineItems: [{ values: { tax_rate: "180" } }] }, undefined), "at most 100");
throws400("discount is strict: a known kind", () => parseInvoiceInput({ ...base, values: { discount: { kind: "half", value: "1" } } }, undefined), "flat");
throws400("a percent discount is at most 100", () => parseInvoiceInput({ ...base, values: { discount: { kind: "percent", value: "120" } } }, undefined), "at most 100");
throws400("two lines can't share an id", () => parseInvoiceInput({
  ...base,
  lineItems: [{ id: "6f1c0d6e-2a4b-4c8d-9e0f-1a2b3c4d5e6f", values: {} }, { id: "6f1c0d6e-2a4b-4c8d-9e0f-1a2b3c4d5e6f", values: {} }],
}, undefined), "repeats");

const money = moneyInputsOf({ discount: { kind: "flat", value: "500", beforeTax: false } }, [{}, { quantity: "2", unit_price: "100" }]);
ok("missing money inputs use their 'if absent' values, so an empty draft totals to zero",
  money.lines[0].quantity === "0" && money.lines[0].unitPrice === 0 && money.lines[0].taxRatePercent === "0" &&
    money.lines[1].unitPrice === 100 && money.discount?.type === "Flat" && money.discountBeforeTax === false);
ok("no discount value -> no discount, before tax by default",
  moneyInputsOf({}, []).discount === null && moneyInputsOf({}, []).discountBeforeTax === true);
ok("a deleted invoice releases its number; search columns come from values",
  derivedColumnsOf({ invoice_number: "INV-1", customer_name: "Bob" }, true).invoiceNumber === null &&
    derivedColumnsOf({ invoice_number: "INV-1", customer_name: "Bob" }, false).invoiceNumber === "INV-1" &&
    derivedColumnsOf({ customer_name: "Bob" }, false).customerName === "Bob");

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
