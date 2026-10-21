import { FieldOwner } from "./registry";

// Field types and the resolved field-definition shape — what the app receives in a compiled
// template's `sections` and in GET /forms. See docs/FIELDS.md §4.

export const FIELD_TYPES = [
  // basic inputs
  "text", "multiline", "number", "money", "boolean", "date", "select", "image", "signature",
  // text with a matching keyboard; the app may warn on a bad format, never blocks
  "phone", "email", "gstin", "pan", "ifsc", "upi_id", "pincode", "hsn_sac",
  // invoice-specific
  "invoice_number", "due_date", "currency_code", "customer", "line_items", "discount",
  // read-only
  "computed", "info",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export const isFieldType = (value: unknown): value is FieldType =>
  typeof value === "string" && (FIELD_TYPES as readonly string[]).includes(value);

// Types that carry behaviour tied to one id. Each may only be used on an id whose registry entry
// lists it (customer -> `customer`, line_items -> `line_items`, computed -> the calculated ids, …).
export const ID_BOUND_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  "invoice_number", "due_date", "customer", "line_items", "discount", "computed",
]);

// What an old app can always draw. A `fallbackType` must be one of these.
export const BASIC_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  "text", "multiline", "number", "boolean", "date", "select", "image",
]);

const TEXT_LIKE: ReadonlySet<FieldType> = new Set<FieldType>([
  "text", "multiline", "phone", "email", "gstin", "pan", "ifsc", "upi_id", "pincode", "hsn_sac",
]);

export const isTextLike = (type: FieldType): boolean => TEXT_LIKE.has(type);

// How a value of each type travels on the wire. The server validates by this (wire.ts), and a
// template may only override a form field's type with one of the same wire kind — so the value
// the app stores always passes the server's check.
export type WireKind =
  | "string"
  | "decimal"
  | "paise"
  | "boolean"
  | "date"
  | "image"
  | "currency"
  | "uuid"
  | "discount"
  | "lines"
  | "none";

export const WIRE_KIND: Readonly<Record<FieldType, WireKind>> = {
  text: "string",
  multiline: "string",
  number: "decimal",
  money: "paise",
  boolean: "boolean",
  date: "date",
  select: "string",
  image: "image",
  signature: "image",
  phone: "string",
  email: "string",
  gstin: "string",
  pan: "string",
  ifsc: "string",
  upi_id: "string",
  pincode: "string",
  hsn_sac: "string",
  invoice_number: "string",
  due_date: "date",
  currency_code: "currency",
  customer: "uuid",
  line_items: "lines",
  discount: "discount",
  computed: "none",
  info: "none",
};

export interface SelectOption {
  value: string;
  label: string;
}

export type DefaultSpec =
  | { kind: "value"; value: unknown }
  | { kind: "today" }
  | { kind: "setting"; id: string };

export interface VisibleIf {
  path: string;
  negate?: boolean;
}

/// A fully-resolved field definition. Inherited type/label/options are already filled in and
/// `owner` is set by the backend, so the app never merges anything. Keys are emitted in a fixed
/// order (resolve.ts) for deterministic compiled output.
export interface FieldDefinition {
  id?: string; // absent only for `info`
  owner?: FieldOwner; // absent only for `info`
  type: FieldType;
  label: string;
  placeholder?: string;
  help?: string;
  default?: DefaultSpec;
  remember?: boolean;
  visibleIf?: VisibleIf;
  fallbackType?: FieldType;
  // type-specific
  maxLength?: number; // text-like
  min?: number; // number
  max?: number; // number
  decimals?: number; // number
  options?: SelectOption[] | string; // select: inline, or the name of a /forms optionList
  relativeTo?: string; // due_date
  presets?: number[]; // due_date: day gaps offered as shortcuts
  format?: "currency" | "number" | "text"; // computed
  text?: string; // info
  columns?: FieldDefinition[]; // line_items
}

/// A titled group of fields — a template section (with `hidable`) or a form section (without).
export interface FormSection {
  id: string;
  label: string;
  fields: FieldDefinition[];
}
