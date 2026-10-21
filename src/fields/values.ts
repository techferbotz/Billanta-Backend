import { FieldOwner, fieldSpec } from "./registry";
import { formField } from "./forms";
import { optionList } from "./optionLists";
import { FieldType, WIRE_KIND, WireKind } from "./types";
import { checkAnyValue, checkDecimal, checkWireValue } from "./wire";

// Validation of a record's values map — what the company, customer, product, settings and invoice
// APIs store (docs/FIELDS.md §7.1). Pure: returns the cleaned map or throws ValuesError, which the
// DTOs turn into a 400.

export type Values = Record<string, unknown>;

// Limits, also mirrored to the app in GET /config `limits` (remoteConfig.defaults.ts imports them).
export const MAX_VALUES_BYTES = 64 * 1024;
export const MAX_LINE_VALUES_BYTES = 8 * 1024;
export const MAX_LINE_ITEMS = 500;

export class ValuesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValuesError";
    Object.setPrototypeOf(this, ValuesError.prototype);
  }
}

// Inputs the money rules read: validated strictly whoever's template set their type (§7.7).
const MONEY_RULES: Record<string, (v: unknown) => string | null> = {
  quantity: (v) => checkDecimal(v, { min: 0 }),
  tax_rate: (v) => checkDecimal(v, { min: 0, max: 100 }),
};

// A state code must be one of the indian_states values: the GST split depends on it.
const STATE_IDS = new Set(["company_state", "customer_state"]);
const STATE_CODES = new Set((optionList("indian_states") ?? []).map((o) => o.value));

// The wire kind the server can be sure of for an id: fixed by the registry, or set by a form.
// Undefined for an invoice field whose type each template chooses.
const knownWireKind = (id: string): WireKind | undefined => {
  const fixed = fieldSpec(id)?.types?.[0] as FieldType | undefined;
  const type = fixed ?? formField(id)?.type;
  return type ? WIRE_KIND[type] : undefined;
};

const checkValue = (id: string, v: unknown): string | null => {
  const money = MONEY_RULES[id];
  if (money) return money(v);
  if (STATE_IDS.has(id)) {
    return typeof v === "string" && STATE_CODES.has(v) ? null : "must be a state code from indian_states";
  }
  const kind = knownWireKind(id);
  return kind ? checkWireValue(kind, v) : checkAnyValue(v);
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export interface ParseValuesOptions {
  // Owners whose ids this record stores.
  owners: readonly FieldOwner[];
  // patch: a null value is kept as a "clear this key" marker; replace: it's simply dropped.
  patch: boolean;
  maxBytes?: number;
}

/**
 * Validate a values map. Every key must be a registered id with an owner the record accepts, and
 * every value must fit its wire kind. "" and null mean "empty": dropped on a replace, kept as null
 * (= clear) on a patch, so stored maps never carry placeholder values (§4.5).
 */
export const parseValues = (raw: unknown, field: string, opts: ParseValuesOptions): Values => {
  if (raw === undefined || raw === null) return {};
  if (!isPlainObject(raw)) throw new ValuesError(`"${field}" must be a JSON object of field id -> value`);

  const out: Values = {};
  for (const [id, value] of Object.entries(raw)) {
    const spec = fieldSpec(id);
    if (!spec) throw new ValuesError(`"${field}.${id}" is not a known field id`);
    if (!opts.owners.includes(spec.owner)) {
      throw new ValuesError(`"${field}.${id}" can't be stored here (it's a ${spec.owner} field)`);
    }
    if (value === null || value === "") {
      if (opts.patch) out[id] = null;
      continue;
    }
    const error = checkValue(id, value);
    if (error) throw new ValuesError(`"${field}.${id}" ${error}`);
    out[id] = value;
  }

  const max = opts.maxBytes ?? MAX_VALUES_BYTES;
  if (Buffer.byteLength(JSON.stringify(out)) > max) {
    throw new ValuesError(`"${field}" is too large (at most ${max / 1024} KB)`);
  }
  return out;
};

/// Apply a patch (from parseValues with patch: true) to a stored map: null clears a key.
export const mergeValues = (stored: Values, patch: Values): Values => {
  const out: Values = { ...stored };
  for (const [id, value] of Object.entries(patch)) {
    if (value === null) delete out[id];
    else out[id] = value;
  }
  return out;
};

/// A stored map as a plain object, whatever Prisma hands back for a JSON column.
export const storedValues = (json: unknown): Values => (isPlainObject(json) ? json : {});

/// A string value, or null — for the few columns derived from a values map (search, uniqueness).
export const stringValue = (values: Values, id: string): string | null => {
  const v = values[id];
  return typeof v === "string" && v.length > 0 ? v : null;
};
