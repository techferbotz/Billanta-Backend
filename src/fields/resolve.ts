import { FIELD_ID_PATTERN, FieldOwner, fieldSpec } from "./registry";
import { optionList } from "./optionLists";
import { checkDecimal, checkWireValue } from "./wire";
import {
  BASIC_TYPES,
  DefaultSpec,
  FieldDefinition,
  FieldType,
  ID_BOUND_TYPES,
  SelectOption,
  VisibleIf,
  WIRE_KIND,
  isFieldType,
  isTextLike,
} from "./types";

// Turns an AUTHORED field definition (a template's data-fields entry, or a form in forms.ts) into
// the fully-resolved definition the app receives (docs/FIELDS.md §4): checks every attribute,
// fills in `owner`, inherits type/label/options from the global form when the author leaves them
// out, and emits keys in one fixed order so compiled output stays byte-identical.
//
// Throws FieldError with a designer-facing message. It knows nothing about source locations —
// the compiler re-throws it as a located CompileError.

export class FieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldError";
    Object.setPrototypeOf(this, FieldError.prototype);
  }
}

// Where a definition appears, which decides the owners it may use.
export type DefinitionPlace = "template" | "column" | "form";

export interface ResolveOptions {
  place: DefinitionPlace;
  // For place "form": the one owner the form stores.
  formOwner?: FieldOwner;
  // For templates: the global form's definition of an id, to inherit type/label/options from.
  inherited?: (id: string) => FieldDefinition | undefined;
}

const ALLOWED_KEYS = new Set([
  "id", "type", "label", "placeholder", "help", "default", "remember", "visibleIf", "fallbackType",
  "maxLength", "min", "max", "decimals", "options", "relativeTo", "presets", "format", "text", "columns",
]);

const MAX_LABEL = 120;
const MAX_PLACEHOLDER = 200;
const MAX_HELP = 500;
const MAX_INFO_TEXT = 1000;
const MAX_COLUMNS = 20;
const MAX_OPTIONS = 200;
const MAX_PRESETS = 12;

// Owners each place accepts.
const PLACE_OWNERS: Record<Exclude<DefinitionPlace, "form">, ReadonlySet<FieldOwner>> = {
  template: new Set<FieldOwner>(["company", "customer", "invoice", "computed"]),
  column: new Set<FieldOwner>(["line", "line_computed"]),
};

// `remember` only makes sense for a value that lives on the invoice or a line and is typed in.
const REMEMBER_OWNERS: ReadonlySet<FieldOwner> = new Set<FieldOwner>(["invoice", "line"]);
const NO_REMEMBER_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  "customer", "line_items", "computed", "info", "invoice_number",
]);
const NO_DEFAULT_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  "customer", "line_items", "computed", "info", "invoice_number",
]);

const fail = (message: string): never => {
  throw new FieldError(message);
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const optionalText = (r: Record<string, unknown>, key: string, max: number, who: string): string | undefined => {
  const v = r[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string" || v.trim().length === 0 || v.length > max) {
    fail(`${who}: "${key}" must be a non-empty string of at most ${max} characters`);
  }
  return v as string;
};

const optionalInt = (
  r: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  who: string
): number | undefined => {
  const v = r[key];
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    fail(`${who}: "${key}" must be a whole number from ${min} to ${max}`);
  }
  return v as number;
};

const optionalNumber = (r: Record<string, unknown>, key: string, who: string): number | undefined => {
  const v = r[key];
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) fail(`${who}: "${key}" must be a number`);
  return v as number;
};

const resolveOptions = (raw: unknown, who: string): SelectOption[] | string => {
  if (typeof raw === "string") {
    if (!optionList(raw)) fail(`${who}: unknown option list "${raw}"`);
    return raw;
  }
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_OPTIONS) {
    fail(`${who}: "options" must be an option-list name or 1–${MAX_OPTIONS} { "value", "label" } objects`);
  }
  const seen = new Set<string>();
  return (raw as unknown[]).map((o) => {
    if (!isPlainObject(o) || Object.keys(o).some((k) => k !== "value" && k !== "label")) {
      fail(`${who}: each option must be { "value", "label" }`);
    }
    const { value, label } = o as Record<string, unknown>;
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_LABEL) {
      fail(`${who}: an option "value" must be a non-empty string of at most ${MAX_LABEL} characters`);
    }
    if (typeof label !== "string" || label.length === 0 || label.length > MAX_LABEL) {
      fail(`${who}: an option "label" must be a non-empty string of at most ${MAX_LABEL} characters`);
    }
    if (seen.has(value as string)) fail(`${who}: option value "${value}" appears twice`);
    seen.add(value as string);
    return { value: value as string, label: label as string };
  });
};

// The option values a select allows, for checking a default.
const optionValues = (options: SelectOption[] | string): string[] =>
  (typeof options === "string" ? optionList(options) ?? [] : options).map((o) => o.value);

const resolveDefault = (
  raw: unknown,
  type: FieldType,
  options: SelectOption[] | string | undefined,
  who: string
): DefaultSpec => {
  if (!isPlainObject(raw)) fail(`${who}: "default" must be an object with a "kind"`);
  const r = raw as Record<string, unknown>;
  if (NO_DEFAULT_TYPES.has(type)) fail(`${who}: a ${type} field can't have a default`);

  switch (r.kind) {
    case "value": {
      if (Object.keys(r).some((k) => k !== "kind" && k !== "value")) fail(`${who}: a value default is { "kind", "value" }`);
      // A due date's default is a number of days after `relativeTo`, not a date.
      const error =
        type === "due_date"
          ? checkDecimal(r.value, { min: 0, max: 3650 }) ?? (/^\d+$/.test(r.value as string) ? null : "must be whole days")
          : checkWireValue(WIRE_KIND[type], r.value);
      if (error) fail(`${who}: default value ${error}`);
      if (type === "select" && options && !optionValues(options).includes(r.value as string)) {
        fail(`${who}: default value "${r.value}" isn't one of the options`);
      }
      return { kind: "value", value: r.value };
    }
    case "today":
      if (Object.keys(r).length !== 1) fail(`${who}: a today default is just { "kind": "today" }`);
      if (type !== "date") fail(`${who}: a "today" default is only for date fields`);
      return { kind: "today" };
    case "setting": {
      if (Object.keys(r).some((k) => k !== "kind" && k !== "id")) fail(`${who}: a setting default is { "kind", "id" }`);
      const id = r.id;
      if (typeof id !== "string" || fieldSpec(id)?.owner !== "settings") {
        fail(`${who}: a setting default needs the "id" of a settings_* field`);
      }
      return { kind: "setting", id: id as string };
    }
    default:
      return fail(`${who}: "default.kind" must be "value", "today" or "setting"`);
  }
};

const resolveVisibleIf = (raw: unknown, who: string): VisibleIf => {
  if (!isPlainObject(raw) || Object.keys(raw).some((k) => k !== "path" && k !== "negate")) {
    fail(`${who}: "visibleIf" must be { "path", "negate"? }`);
  }
  const { path, negate } = raw as Record<string, unknown>;
  if (typeof path !== "string" || !FIELD_ID_PATTERN.test(path)) fail(`${who}: "visibleIf.path" must be a field id`);
  if (negate !== undefined && typeof negate !== "boolean") fail(`${who}: "visibleIf.negate" must be true or false`);
  return negate ? { path: path as string, negate: true } : { path: path as string };
};

const resolveInfo = (r: Record<string, unknown>): FieldDefinition => {
  const who = "an info field";
  for (const key of Object.keys(r)) {
    if (key !== "type" && key !== "label" && key !== "text" && key !== "visibleIf") {
      fail(`${who}: "${key}" isn't used on info fields`);
    }
  }
  const text = r.text;
  if (typeof text !== "string" || text.trim().length === 0 || text.length > MAX_INFO_TEXT) {
    fail(`${who}: "text" must be a non-empty string of at most ${MAX_INFO_TEXT} characters`);
  }
  const label = optionalText(r, "label", MAX_LABEL, who) ?? "";
  const out: FieldDefinition = { type: "info", label };
  if (r.visibleIf !== undefined) out.visibleIf = resolveVisibleIf(r.visibleIf, who);
  out.text = text as string;
  return out;
};

/**
 * Resolve one authored field definition. See the file header; the rules are docs/FIELDS.md §4
 * and §6.5 (checks 2–4).
 */
export const resolveField = (raw: unknown, opts: ResolveOptions): FieldDefinition => {
  if (!isPlainObject(raw)) fail("each field must be a JSON object");
  const r = raw as Record<string, unknown>;
  const idText = typeof r.id === "string" ? r.id : undefined;
  const who = idText ? `field "${idText}"` : "a field";

  if ("owner" in r) fail(`${who}: "owner" is set by the backend; remove it`);
  for (const key of Object.keys(r)) {
    if (!ALLOWED_KEYS.has(key)) fail(`${who}: unknown attribute "${key}"`);
  }
  if (r.type !== undefined && !isFieldType(r.type)) fail(`${who}: unknown type "${String(r.type)}"`);
  if (r.type === "info") return resolveInfo(r);

  // --- id and owner ---------------------------------------------------------------------
  if (typeof r.id !== "string") fail('each field needs an "id" (only info fields have none)');
  const id = r.id as string;
  const spec = fieldSpec(id);
  if (!spec) fail(`unknown field id "${id}" — add it to the backend list (src/fields/registry.ts) first`);
  const owner = spec!.owner;

  if (opts.place === "form") {
    if (owner !== opts.formOwner) fail(`${who} belongs to the ${owner}, not the ${opts.formOwner} form`);
  } else if (!PLACE_OWNERS[opts.place].has(owner)) {
    if (opts.place === "column") fail(`${who} can't be a line_items column (it's a ${owner} field)`);
    if (owner === "settings") {
      fail(`${who} is a setting; use it as a default ({ "kind": "setting", "id": "${id}" }) instead`);
    }
    fail(`${who} is a line-item field; list it in a line_items field's "columns"`);
  }

  // --- type and label (inherited from the global form when left out) --------------------
  const inherited = opts.place === "form" ? undefined : opts.inherited?.(id);
  const given = r.type as FieldType | undefined;
  const type = (given ?? (spec!.types?.[0] as FieldType | undefined) ?? inherited?.type) as FieldType | undefined;
  if (!type) fail(`${who}: "type" is required`);
  if (spec!.types && !spec!.types.includes(type!)) {
    fail(`${who} must have type ${spec!.types.map((t) => `"${t}"`).join(" or ")}`);
  }
  if (ID_BOUND_TYPES.has(type!) && !spec!.types?.includes(type!)) {
    fail(`${who}: type "${type}" can only be used on its own field`);
  }
  if (inherited && given && WIRE_KIND[given] !== WIRE_KIND[inherited.type]) {
    fail(
      `${who} has type "${inherited.type}" on the ${owner} form; a template may only change it to a ` +
        `type stored the same way`
    );
  }
  const label = optionalText(r, "label", MAX_LABEL, who) ?? inherited?.label ?? spec!.label;
  if (!label) fail(`${who}: "label" is required`);

  // --- type-specific attributes ---------------------------------------------------------
  const onlyFor = (key: string, ok: boolean, what: string): void => {
    if (r[key] !== undefined && !ok) fail(`${who}: "${key}" is only for ${what}`);
  };
  onlyFor("maxLength", isTextLike(type!), "text fields");
  onlyFor("min", type === "number", "number fields");
  onlyFor("max", type === "number", "number fields");
  onlyFor("decimals", type === "number", "number fields");
  onlyFor("options", type === "select", "select fields");
  onlyFor("relativeTo", type === "due_date", "due_date fields");
  onlyFor("presets", type === "due_date", "due_date fields");
  onlyFor("format", type === "computed", "computed fields");
  onlyFor("text", false, "info fields");
  onlyFor("columns", type === "line_items", "the line_items field");

  let options: SelectOption[] | string | undefined;
  if (type === "select") {
    if (r.options !== undefined && spec!.types && opts.place !== "form") {
      fail(`${who} always uses the options from the ${owner} form`);
    }
    options =
      r.options !== undefined
        ? resolveOptions(r.options, who)
        : inherited?.type === "select"
          ? inherited.options
          : undefined;
    if (!options) fail(`${who}: a select needs "options"`);
  }

  const min = optionalNumber(r, "min", who);
  const max = optionalNumber(r, "max", who);
  if (min !== undefined && max !== undefined && min > max) fail(`${who}: "min" is greater than "max"`);

  let presets: number[] | undefined;
  if (r.presets !== undefined) {
    const p = r.presets;
    if (
      !Array.isArray(p) || p.length === 0 || p.length > MAX_PRESETS ||
      p.some((d) => typeof d !== "number" || !Number.isInteger(d) || d < 0 || d > 3650) ||
      new Set(p).size !== p.length
    ) {
      fail(`${who}: "presets" must be 1–${MAX_PRESETS} different whole numbers of days (0–3650)`);
    }
    presets = p as number[];
  }

  let relativeTo: string | undefined;
  if (type === "due_date") {
    relativeTo = r.relativeTo === undefined ? "invoice_date" : (r.relativeTo as string);
    if (typeof relativeTo !== "string" || fieldSpec(relativeTo)?.owner !== "invoice") {
      fail(`${who}: "relativeTo" must be an invoice date field such as "invoice_date"`);
    }
  }

  let format: FieldDefinition["format"];
  if (type === "computed") {
    const f = r.format ?? "currency";
    if (f !== "currency" && f !== "number" && f !== "text") fail(`${who}: "format" must be currency, number or text`);
    format = f as FieldDefinition["format"];
  }

  let columns: FieldDefinition[] | undefined;
  if (type === "line_items") {
    const c = r.columns;
    if (!Array.isArray(c) || c.length === 0 || c.length > MAX_COLUMNS) {
      fail(`${who}: "columns" must list 1–${MAX_COLUMNS} line-item fields`);
    }
    const seen = new Set<string>();
    columns = (c as unknown[]).map((col) => {
      const def = resolveField(col, { ...opts, place: "column" });
      if (def.id) {
        if (seen.has(def.id)) fail(`${who}: column "${def.id}" is listed twice`);
        seen.add(def.id);
      }
      return def;
    });
  }

  // --- behaviour ------------------------------------------------------------------------
  let remember: boolean | undefined;
  if (r.remember !== undefined) {
    if (typeof r.remember !== "boolean") fail(`${who}: "remember" must be true or false`);
    if (r.remember) {
      if (opts.place === "form" || !REMEMBER_OWNERS.has(owner)) {
        fail(`${who}: "remember" has no effect here — a ${owner} field is already saved on its record`);
      }
      if (NO_REMEMBER_TYPES.has(type!)) fail(`${who}: a ${type} field can't be remembered`);
      remember = true;
    }
  }

  const fallbackType = r.fallbackType;
  if (fallbackType !== undefined) {
    if (!isFieldType(fallbackType) || !BASIC_TYPES.has(fallbackType)) {
      fail(`${who}: "fallbackType" must be one of ${[...BASIC_TYPES].join(", ")}`);
    }
    if (fallbackType === type) fail(`${who}: "fallbackType" is the same as "type"`);
  }

  // --- emit, in the fixed key order -----------------------------------------------------
  const out: FieldDefinition = { id, owner, type: type!, label: label! };
  const placeholder = optionalText(r, "placeholder", MAX_PLACEHOLDER, who);
  if (placeholder !== undefined) out.placeholder = placeholder;
  const help = optionalText(r, "help", MAX_HELP, who);
  if (help !== undefined) out.help = help;
  if (r.default !== undefined) out.default = resolveDefault(r.default, type!, options, who);
  if (remember) out.remember = true;
  if (r.visibleIf !== undefined) out.visibleIf = resolveVisibleIf(r.visibleIf, who);
  if (fallbackType !== undefined) out.fallbackType = fallbackType as FieldType;
  const maxLength = optionalInt(r, "maxLength", 1, 5000, who);
  if (maxLength !== undefined) out.maxLength = maxLength;
  if (min !== undefined) out.min = min;
  if (max !== undefined) out.max = max;
  const decimals = optionalInt(r, "decimals", 0, 6, who);
  if (decimals !== undefined) out.decimals = decimals;
  if (options !== undefined) out.options = options;
  if (relativeTo !== undefined) out.relativeTo = relativeTo;
  if (presets !== undefined) out.presets = presets;
  if (format !== undefined) out.format = format;
  if (columns !== undefined) out.columns = columns;
  return out;
};
