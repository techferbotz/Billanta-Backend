import { WireKind } from "./types";

// Pure checks of a value against its wire kind (docs/FIELDS.md §4.3, §7.1). Each returns null
// when the value is fine, or a message to append to the field's name ("must be …"). They know
// nothing about HTTP or source locations, so the API (values.ts) and the template compiler
// (checking a `default`) both use them.

export const MAX_TEXT_LENGTH = 5000;
export const MAX_URL_LENGTH = 1000;
// Long enough for any real quantity or rate; short enough that a pathological digit string
// can't drive heavy decimal arithmetic.
const MAX_DECIMAL_LENGTH = 30;

const DECIMAL = /^-?\d+(\.\d+)?$/;
const PAISE = /^\d+$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CURRENCY = /^[A-Z]{3}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const checkString = (v: unknown, maxLength = MAX_TEXT_LENGTH): string | null =>
  typeof v === "string" && v.length <= maxLength ? null : `must be a string of at most ${maxLength} characters`;

export const checkDecimal = (v: unknown, opts: { min?: number; max?: number } = {}): string | null => {
  if (typeof v !== "string" || v.length > MAX_DECIMAL_LENGTH || !DECIMAL.test(v)) {
    return 'must be a decimal string such as "2.5"';
  }
  const n = Number(v);
  if (opts.min !== undefined && n < opts.min) return `must be at least ${opts.min}`;
  if (opts.max !== undefined && n > opts.max) return `must be at most ${opts.max}`;
  return null;
};

export const checkPaise = (v: unknown): string | null =>
  typeof v === "string" && PAISE.test(v) && Number(v) <= Number.MAX_SAFE_INTEGER
    ? null
    : 'must be a whole number of paise as a string, such as "150000"';

export const checkDate = (v: unknown): string | null => {
  const m = typeof v === "string" ? DATE.exec(v) : null;
  if (m) {
    const [, y, mo, d] = m.map(Number);
    const date = new Date(Date.UTC(y, mo - 1, d));
    if (date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d) return null;
  }
  return 'must be a date as "YYYY-MM-DD"';
};

export const checkHttpsUrl = (v: unknown): string | null => {
  if (typeof v !== "string" || v.length > MAX_URL_LENGTH) return `must be an https URL of at most ${MAX_URL_LENGTH} characters`;
  try {
    const url = new URL(v);
    if (url.protocol === "https:" && url.hostname.length > 0) return null;
  } catch {
    // reported below
  }
  return "must be an absolute https URL";
};

// { url, thumbnailUrl? } — what POST /media returned.
export const checkImage = (v: unknown): string | null => {
  if (!isPlainObject(v)) return 'must be an image object { "url", "thumbnailUrl" }';
  for (const key of Object.keys(v)) {
    if (key !== "url" && key !== "thumbnailUrl") return `has an unknown key "${key}" (only "url" and "thumbnailUrl")`;
  }
  const urlError = checkHttpsUrl(v.url);
  if (urlError) return `"url" ${urlError}`;
  if (v.thumbnailUrl !== undefined && v.thumbnailUrl !== null) {
    const thumbError = checkHttpsUrl(v.thumbnailUrl);
    if (thumbError) return `"thumbnailUrl" ${thumbError}`;
  }
  return null;
};

// { kind: "flat" | "percent", value, beforeTax? } — a flat value is paise, a percent is 0–100.
export const checkDiscount = (v: unknown): string | null => {
  if (!isPlainObject(v)) return 'must be a discount object { "kind", "value", "beforeTax" }';
  for (const key of Object.keys(v)) {
    if (key !== "kind" && key !== "value" && key !== "beforeTax") return `has an unknown key "${key}"`;
  }
  if (v.kind !== "flat" && v.kind !== "percent") return '"kind" must be "flat" or "percent"';
  const valueError = v.kind === "flat" ? checkPaise(v.value) : checkDecimal(v.value, { min: 0, max: 100 });
  if (valueError) return `"value" ${valueError}`;
  if (v.beforeTax !== undefined && typeof v.beforeTax !== "boolean") return '"beforeTax" must be true or false';
  return null;
};

export const checkWireValue = (kind: WireKind, v: unknown): string | null => {
  switch (kind) {
    case "string":
      return checkString(v);
    case "decimal":
      return checkDecimal(v);
    case "paise":
      return checkPaise(v);
    case "boolean":
      return typeof v === "boolean" ? null : "must be true or false";
    case "date":
      return checkDate(v);
    case "image":
      return checkImage(v);
    case "currency":
      return typeof v === "string" && CURRENCY.test(v) ? null : 'must be a 3-letter ISO 4217 code such as "INR"';
    case "uuid":
      return typeof v === "string" && UUID.test(v) ? null : "must be a UUID";
    case "discount":
      return checkDiscount(v);
    case "lines":
      return 'isn\'t a value; an invoice\'s lines travel in "lineItems"';
    case "none":
      return "can't be stored as a value";
  }
};

// A value whose wire kind the server doesn't know (an invoice field whose type each template
// chooses): anything a field can hold, within the size limits.
export const checkAnyValue = (v: unknown): string | null => {
  if (typeof v === "string") return checkString(v);
  if (typeof v === "boolean") return null;
  if (isPlainObject(v)) return checkImage(v);
  return "must be a string, true/false, an image object or null (numbers travel as decimal strings)";
};
