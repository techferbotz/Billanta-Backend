// THE field-id registry: every id a template, a form or a stored values map may use, and who owns
// its value. See docs/FIELDS.md §3.
//
// One id is the storage key, the editor key and the template binding all at once, so this list is
// the vocabulary everything else is checked against. It is ADDITIVE ONLY: an id is never renamed,
// never reused for something else and never changes owner — a changed meaning gets a new id.
//
// Most ids carry no type here: a template sets the type of each field it lists, and the global
// forms (forms.ts) set the type of the company/customer/product/settings ids. `types` exists only
// for ids whose value the SERVER reads (money inputs, state codes) or whose value has a special
// shape — there the type can't be a template's choice, because the server validates the value.

export type FieldOwner =
  | "company" // saved on the business profile
  | "customer" // saved on the customer picked on the invoice
  | "invoice" // saved on the invoice only
  | "line" // saved on one line item; products use the same ids
  | "settings" // saved in the user's settings; templates use these only as defaults
  | "computed" // calculated by the money rules, never stored
  | "line_computed"; // calculated per line, never stored

export interface FieldIdSpec {
  owner: FieldOwner;
  // The only types this id may have; the first is implied when a definition leaves `type` out.
  types?: string[];
  // A default label, for ids no form labels (the computed ones).
  label?: string;
}

const company = (): FieldIdSpec => ({ owner: "company" });
const customer = (): FieldIdSpec => ({ owner: "customer" });
const invoice = (types?: string[]): FieldIdSpec => (types ? { owner: "invoice", types } : { owner: "invoice" });
const line = (types?: string[]): FieldIdSpec => (types ? { owner: "line", types } : { owner: "line" });
const settings = (): FieldIdSpec => ({ owner: "settings" });
const computed = (label: string): FieldIdSpec => ({ owner: "computed", types: ["computed"], label });
const lineComputed = (label: string): FieldIdSpec => ({ owner: "line_computed", types: ["computed"], label });

export const FIELD_IDS: Readonly<Record<string, FieldIdSpec>> = {
  // --- business profile ------------------------------------------------------------------
  company_name: company(),
  company_logo: company(),
  company_gstin: company(),
  company_pan: company(),
  company_address_line1: company(),
  company_address_line2: company(),
  company_city: company(),
  // The GST state code drives the CGST+SGST vs IGST split, so the server validates it.
  company_state: { owner: "company", types: ["select"] },
  company_pincode: company(),
  company_country: company(),
  company_phone: company(),
  company_email: company(),
  company_website: company(),
  company_bank_name: company(),
  company_bank_account_name: company(),
  company_bank_account_number: company(),
  company_bank_ifsc: company(),
  company_bank_branch: company(),
  company_upi_id: company(),
  company_upi_qr: company(),
  company_signature: company(),
  company_signatory_name: company(),
  company_signatory_designation: company(),

  // --- customer --------------------------------------------------------------------------
  customer_name: customer(),
  customer_contact_person: customer(),
  customer_phone: customer(),
  customer_email: customer(),
  customer_gstin: customer(),
  customer_address_line1: customer(),
  customer_address_line2: customer(),
  customer_city: customer(),
  // Also the place of supply: the other half of the CGST+SGST vs IGST decision.
  customer_state: { owner: "customer", types: ["select"] },
  customer_pincode: customer(),
  customer_country: customer(),

  // --- invoice ---------------------------------------------------------------------------
  customer: invoice(["customer"]), // which saved customer is billed: the customer's id
  invoice_number: invoice(["invoice_number"]),
  invoice_date: invoice(["date"]),
  due_date: invoice(["due_date", "date"]),
  currency: invoice(["currency_code"]), // money input
  po_number: invoice(),
  line_items: invoice(["line_items"]),
  discount: invoice(["discount"]), // money input
  notes: invoice(),
  terms: invoice(),
  hide_gst_column: invoice(),

  // --- line item / product -----------------------------------------------------------------
  description: line(),
  image: line(),
  hsn_sac: line(),
  unit: line(),
  quantity: line(["number"]), // money input
  unit_price: line(["money"]), // money input
  tax_rate: line(["number"]), // money input

  // --- settings --------------------------------------------------------------------------
  settings_invoice_prefix: settings(),
  settings_next_invoice_number: settings(),
  settings_default_currency: settings(),
  settings_default_tax_rate: settings(),
  settings_default_due_days: settings(),
  settings_default_notes: settings(),
  settings_default_terms: settings(),

  // --- calculated --------------------------------------------------------------------------
  subtotal: computed("Subtotal"),
  discount_total: computed("Discount"),
  tax_total: computed("Tax"),
  cgst_total: computed("CGST"),
  sgst_total: computed("SGST"),
  igst_total: computed("IGST"),
  grand_total: computed("Total"),
  line_total: lineComputed("Amount"),
  tax_amount: lineComputed("Tax"),
};

// The pattern every id follows (docs/FIELDS.md §3.1).
export const FIELD_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
export const MAX_FIELD_ID_LENGTH = 64;

// The prefix each owner's ids must carry, so an id reads as where it lives. Line and computed ids
// have no prefix; check:forms asserts every id matches its owner.
export const OWNER_PREFIX: Partial<Record<FieldOwner, string>> = {
  company: "company_",
  customer: "customer_",
  settings: "settings_",
};

export const fieldSpec = (id: string): FieldIdSpec | undefined =>
  Object.prototype.hasOwnProperty.call(FIELD_IDS, id) ? FIELD_IDS[id] : undefined;

// The calculated ids, in the order the money rules produce them.
export const COMPUTED_IDS = Object.keys(FIELD_IDS).filter((id) => FIELD_IDS[id].owner === "computed");
export const LINE_COMPUTED_IDS = Object.keys(FIELD_IDS).filter(
  (id) => FIELD_IDS[id].owner === "line_computed"
);
