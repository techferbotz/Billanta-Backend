import { createHash } from "node:crypto";
import { FieldOwner } from "./registry";
import { OPTION_LISTS } from "./optionLists";
import { FieldError, resolveField } from "./resolve";
import { FieldDefinition, FormSection } from "./types";

// The four global forms (docs/FIELDS.md §5): the business profile, customer, product and settings
// screens, built by the app entirely from GET /forms. A new field here is a backend deploy, not an
// app release. They also supply the type/label/options a template inherits for these ids.
//
// Authored in the same shape as a template's data-fields and resolved by the same code, so a form
// mistake fails at startup (and in check:forms) exactly like a template mistake fails a publish.

export type FormName = "company" | "customer" | "product" | "settings";

interface AuthoredSection {
  id: string;
  label: string;
  fields: Record<string, unknown>[];
}

const STATE = { type: "select", options: "indian_states" };
const INDIA = { default: { kind: "value", value: "India" } };

const AUTHORED: Record<FormName, AuthoredSection[]> = {
  company: [
    {
      id: "business",
      label: "Business details",
      fields: [
        { id: "company_name", type: "text", label: "Business name", maxLength: 200 },
        { id: "company_logo", type: "image", label: "Logo" },
        { id: "company_gstin", type: "gstin", label: "GSTIN" },
        { id: "company_pan", type: "pan", label: "PAN" },
        { id: "company_phone", type: "phone", label: "Phone" },
        { id: "company_email", type: "email", label: "Email" },
        { id: "company_website", type: "text", label: "Website" },
      ],
    },
    {
      id: "address",
      label: "Address",
      fields: [
        { id: "company_address_line1", type: "text", label: "Address line 1" },
        { id: "company_address_line2", type: "text", label: "Address line 2" },
        { id: "company_city", type: "text", label: "City" },
        { id: "company_state", ...STATE, label: "State" },
        { id: "company_pincode", type: "pincode", label: "PIN code" },
        { id: "company_country", type: "text", label: "Country", ...INDIA },
      ],
    },
    {
      id: "bank",
      label: "Bank details",
      fields: [
        { id: "company_bank_name", type: "text", label: "Bank name" },
        { id: "company_bank_account_name", type: "text", label: "Account name" },
        { id: "company_bank_account_number", type: "text", label: "Account number" },
        { id: "company_bank_ifsc", type: "ifsc", label: "IFSC" },
        { id: "company_bank_branch", type: "text", label: "Branch" },
      ],
    },
    {
      id: "upi",
      label: "UPI",
      fields: [
        { id: "company_upi_id", type: "upi_id", label: "UPI ID" },
        { id: "company_upi_qr", type: "image", label: "UPI QR code" },
      ],
    },
    {
      id: "signature",
      label: "Signature",
      fields: [
        { id: "company_signature", type: "signature", label: "Signature" },
        { id: "company_signatory_name", type: "text", label: "Signatory name" },
        { id: "company_signatory_designation", type: "text", label: "Designation" },
      ],
    },
  ],

  customer: [
    {
      id: "customer",
      label: "Customer",
      fields: [
        { id: "customer_name", type: "text", label: "Customer name", maxLength: 200 },
        { id: "customer_contact_person", type: "text", label: "Contact person" },
        { id: "customer_phone", type: "phone", label: "Phone" },
        { id: "customer_email", type: "email", label: "Email" },
        { id: "customer_gstin", type: "gstin", label: "GSTIN" },
      ],
    },
    {
      id: "address",
      label: "Address",
      fields: [
        { id: "customer_address_line1", type: "text", label: "Address line 1" },
        { id: "customer_address_line2", type: "text", label: "Address line 2" },
        { id: "customer_city", type: "text", label: "City" },
        { id: "customer_state", ...STATE, label: "State", help: "Also the place of supply" },
        { id: "customer_pincode", type: "pincode", label: "PIN code" },
        { id: "customer_country", type: "text", label: "Country", ...INDIA },
      ],
    },
  ],

  product: [
    {
      id: "product",
      label: "Product",
      fields: [
        { id: "description", type: "text", label: "Product name", maxLength: 500 },
        { id: "image", type: "image", label: "Photo" },
        { id: "hsn_sac", type: "hsn_sac", label: "HSN/SAC" },
        { id: "unit", type: "text", label: "Unit", placeholder: "pcs, kg, hour" },
        { id: "unit_price", label: "Rate" },
        {
          id: "tax_rate",
          label: "GST %",
          min: 0,
          max: 100,
          default: { kind: "setting", id: "settings_default_tax_rate" },
        },
      ],
    },
  ],

  settings: [
    {
      id: "invoice_numbering",
      label: "Invoice numbering",
      fields: [
        { id: "settings_invoice_prefix", type: "text", label: "Invoice number prefix", default: { kind: "value", value: "INV-" } },
        {
          id: "settings_next_invoice_number",
          type: "number",
          label: "Next invoice number",
          min: 1,
          decimals: 0,
          default: { kind: "value", value: "1" },
        },
      ],
    },
    {
      id: "defaults",
      label: "Defaults for new invoices",
      fields: [
        { id: "settings_default_currency", type: "currency_code", label: "Currency", default: { kind: "value", value: "INR" } },
        { id: "settings_default_tax_rate", type: "number", label: "GST %", min: 0, max: 100 },
        { id: "settings_default_due_days", type: "number", label: "Due in (days)", min: 0, decimals: 0 },
        { id: "settings_default_notes", type: "multiline", label: "Notes" },
        { id: "settings_default_terms", type: "multiline", label: "Terms" },
      ],
    },
  ],
};

// Which owner each form stores.
export const FORM_OWNER: Record<FormName, FieldOwner> = {
  company: "company",
  customer: "customer",
  product: "line",
  settings: "settings",
};

const resolveForm = (name: FormName): { sections: FormSection[] } => {
  const sectionIds = new Set<string>();
  const fieldIds = new Set<string>();
  const sections = AUTHORED[name].map((s) => {
    if (sectionIds.has(s.id)) throw new FieldError(`${name} form: section "${s.id}" appears twice`);
    sectionIds.add(s.id);
    const fields = s.fields.map((f) => {
      const def = resolveField(f, { place: "form", formOwner: FORM_OWNER[name] });
      if (def.id && fieldIds.has(def.id)) throw new FieldError(`${name} form: "${def.id}" appears twice`);
      if (def.id) fieldIds.add(def.id);
      return def;
    });
    return { id: s.id, label: s.label, fields };
  });
  // A visibleIf must point at a field on the same form.
  for (const s of sections) {
    for (const f of s.fields) {
      if (f.visibleIf && !fieldIds.has(f.visibleIf.path)) {
        throw new FieldError(`${name} form: "${f.id}" visibleIf points at "${f.visibleIf.path}", not on this form`);
      }
    }
  }
  return { sections };
};

// Resolved once at module load: a malformed form fails startup, never a request.
export const FORMS: Readonly<Record<FormName, { sections: FormSection[] }>> = {
  company: resolveForm("company"),
  customer: resolveForm("customer"),
  product: resolveForm("product"),
  settings: resolveForm("settings"),
};

// Every form field by id — what a template inherits when it leaves out a type or label, and what
// the server checks a stored value against.
export const FORM_FIELDS: ReadonlyMap<string, FieldDefinition> = new Map(
  Object.values(FORMS).flatMap((form) =>
    form.sections.flatMap((s) => s.fields.filter((f) => f.id).map((f) => [f.id!, f] as const))
  )
);

export const formField = (id: string): FieldDefinition | undefined => FORM_FIELDS.get(id);

// Bump when GET /forms changes shape incompatibly. Adding forms, sections or fields: no bump.
export const FORMS_SCHEMA_VERSION = 1;

/// The GET /forms document, built once, with its sha256 (the ETag).
export const FORMS_DOCUMENT = {
  schemaVersion: FORMS_SCHEMA_VERSION,
  optionLists: OPTION_LISTS,
  forms: FORMS,
};

export const FORMS_CHECKSUM = createHash("sha256").update(JSON.stringify(FORMS_DOCUMENT)).digest("hex");

// The starting values of a fresh settings record: each settings field's literal default.
export const settingsDefaults = (): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const s of FORMS.settings.sections) {
    for (const f of s.fields) {
      if (f.id && f.default?.kind === "value") out[f.id] = f.default.value;
    }
  }
  return out;
};
