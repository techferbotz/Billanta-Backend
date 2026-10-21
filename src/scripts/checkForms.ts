/**
 * Verification of the field registry and the global forms (docs/FIELDS.md §3, §5) — no DB, no
 * server. The forms are resolved at module load, so importing them already proves every form field
 * passes the same checks a template's fields do; this adds the cross-cutting rules.
 *
 * Run: npx ts-node src/scripts/checkForms.ts  (or npm run check:forms)
 */
import { createHash } from "node:crypto";
import { FIELD_IDS, FIELD_ID_PATTERN, MAX_FIELD_ID_LENGTH, OWNER_PREFIX } from "../fields/registry";
import { FORMS, FORMS_CHECKSUM, FORMS_DOCUMENT, FORM_FIELDS, FORM_OWNER, FormName, settingsDefaults } from "../fields/forms";
import { OPTION_LISTS } from "../fields/optionLists";
import { isFieldType } from "../fields/types";

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

console.log("\nregistry");
const ids = Object.keys(FIELD_IDS);
const badShape = ids.filter((id) => !FIELD_ID_PATTERN.test(id) || id.length > MAX_FIELD_ID_LENGTH);
ok("every id is snake_case and at most 64 characters", badShape.length === 0, badShape.join(", "));

const prefixes = Object.entries(OWNER_PREFIX);
const badPrefix = ids.filter((id) => {
  const owner = FIELD_IDS[id].owner;
  const own = OWNER_PREFIX[owner];
  // An owner with a prefix: its ids carry it. Every other owner: its ids carry none of them.
  return own ? !id.startsWith(own) : prefixes.some(([, p]) => p && id.startsWith(p));
});
ok("every id's prefix matches its owner (company_, customer_, settings_)", badPrefix.length === 0, badPrefix.join(", "));

const badTypes = ids.filter((id) => (FIELD_IDS[id].types ?? []).some((t) => !isFieldType(t)));
ok("every fixed type in the registry is a known field type", badTypes.length === 0, badTypes.join(", "));

console.log("\nforms");
for (const name of Object.keys(FORMS) as FormName[]) {
  const owner = FORM_OWNER[name];
  const fields = FORMS[name].sections.flatMap((s) => s.fields);
  ok(`${name} form: every field is a ${owner} field`, fields.every((f) => f.owner === owner));
  // Every id the form's owner has appears on the form, so a template can always inherit its type —
  // except quantity, which belongs to the line, not the product.
  const missing = ids.filter((id) => FIELD_IDS[id].owner === owner && id !== "quantity" && !fields.some((f) => f.id === id));
  ok(`${name} form: lists every ${owner} id`, missing.length === 0, missing.join(", "));
}
ok("the product form leaves out quantity", !FORMS.product.sections.some((s) => s.fields.some((f) => f.id === "quantity")));
ok("no form field is remembered (records already save them)", [...FORM_FIELDS.values()].every((f) => !f.remember));
ok("the state fields use the indian_states list",
  FORM_FIELDS.get("company_state")?.options === "indian_states" && FORM_FIELDS.get("customer_state")?.options === "indian_states");

const defaults = settingsDefaults();
ok("a new settings record starts with the prefix, the counter and the currency",
  defaults.settings_invoice_prefix === "INV-" && defaults.settings_next_invoice_number === "1" && defaults.settings_default_currency === "INR",
  JSON.stringify(defaults));

console.log("\noption lists");
for (const [name, list] of Object.entries(OPTION_LISTS)) {
  ok(`${name}: values are unique`, new Set(list.map((o) => o.value)).size === list.length);
}
ok("indian_states: every value is a 2-digit GST state code", OPTION_LISTS.indian_states.every((o) => /^\d{2}$/.test(o.value)));

console.log("\nGET /forms document");
ok("JSON-clean (survives a round trip unchanged)", JSON.stringify(JSON.parse(JSON.stringify(FORMS_DOCUMENT))) === JSON.stringify(FORMS_DOCUMENT));
ok("the ETag is the sha256 of the document",
  FORMS_CHECKSUM === createHash("sha256").update(JSON.stringify(FORMS_DOCUMENT)).digest("hex"));

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
