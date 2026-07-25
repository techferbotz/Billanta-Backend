import { BadRequestError } from "./errors/AppError";

// Small, shared input validators. Controllers use these to check the SHAPE of a request
// before handing it to a service — business rules stay in the service layer.

/**
 * Require a non-empty string field, returning it trimmed.
 *
 * Note this rejects a non-string as well as a missing value, which matters because JSON
 * bodies are attacker-controlled: `{"idToken": {"$ne": null}}` or `{"name": 123}` must
 * not flow into a query or a database write untyped.
 */
export const requireString = (value: unknown, field: string, maxLength = 500): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestError(`"${field}" is required and must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new BadRequestError(`"${field}" must be at most ${maxLength} characters`);
  }
  return trimmed;
};

/**
 * Read an optional string field.
 *
 * Returns `undefined` when the key is absent (meaning "don't change this"), and `null`
 * when the client explicitly sends null (meaning "clear this"). PATCH handlers depend on
 * that distinction — collapsing both to null would wipe fields the client never mentioned.
 */
export const optionalString = (
  value: unknown,
  field: string,
  maxLength = 500
): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new BadRequestError(`"${field}" must be a string or null`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) {
    throw new BadRequestError(`"${field}" must be at most ${maxLength} characters`);
  }
  return trimmed;
};

// Require the request body to be a JSON object (express.json() yields {} for an empty
// body, and could yield an array or a bare value for a hostile one).
export const requireObjectBody = (body: unknown): Record<string, unknown> => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("Request body must be a JSON object");
  }
  return body as Record<string, unknown>;
};

/**
 * Read an optional finite number field.
 *
 * Like optionalString, distinguishes absent (`undefined` = leave unchanged) from explicit
 * `null` (clear). Rejects NaN/Infinity and non-numbers, so `{"nextInvoiceNumber":"7"}` or
 * a hostile `{"defaultTaxPercent":{}}` never reaches a Decimal column untyped.
 */
export const optionalNumber = (
  value: unknown,
  field: string,
  opts: { min?: number; max?: number } = {}
): number | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BadRequestError(`"${field}" must be a finite number or null`);
  }
  if (opts.min !== undefined && value < opts.min) {
    throw new BadRequestError(`"${field}" must be at least ${opts.min}`);
  }
  if (opts.max !== undefined && value > opts.max) {
    throw new BadRequestError(`"${field}" must be at most ${opts.max}`);
  }
  return value;
};

/**
 * Read an optional decimal field destined for a Prisma `Decimal` column (a tax rate,
 * later a quantity), returning the EXACT canonical string — never a JS number.
 *
 * Accepts BOTH a JSON number and a numeric string, and this is the whole point: the DTO
 * serializes a Decimal back out as a string (to preserve precision), and under the
 * full-replace/merge contract the offline client replays exactly what it received. If the
 * parser accepted only numbers, the server would 400 on its own output. Keeping the value
 * as a string end-to-end also avoids the float round-trip that storing money/rates as a JS
 * number would reintroduce.
 *
 * Absent => undefined (leave unchanged); explicit null => null (clear).
 */
export const optionalDecimalString = (
  value: unknown,
  field: string,
  opts: { min?: number; max?: number } = {}
): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;

  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new BadRequestError(`"${field}" must be a finite number`);
    }
    text = String(value);
  } else if (typeof value === "string") {
    text = value.trim();
    if (text.length === 0) return null;
  } else {
    throw new BadRequestError(`"${field}" must be a number, a numeric string, or null`);
  }

  // A plain decimal: optional sign, digits, optional fractional part. No exponent, no
  // NaN/Infinity — those have no place in a monetary rate and would poison the Decimal.
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    throw new BadRequestError(`"${field}" must be a decimal number (e.g. "18" or "2.5")`);
  }

  const numeric = Number(text);
  if (opts.min !== undefined && numeric < opts.min) {
    throw new BadRequestError(`"${field}" must be at least ${opts.min}`);
  }
  if (opts.max !== undefined && numeric > opts.max) {
    throw new BadRequestError(`"${field}" must be at most ${opts.max}`);
  }
  return text;
};

// ISO 4217 currency codes are three uppercase letters (INR, USD, …). We validate the shape
// rather than the full registry — the client picks from a fixed list, and rejecting a
// well-formed-but-obscure code would be worse than accepting it.
const CURRENCY_SHAPE = /^[A-Z]{3}$/;

// Validate an optional ISO 4217 code, returned upper-cased. Absent => undefined.
export const optionalCurrency = (
  value: unknown,
  field = "currency"
): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new BadRequestError(`"${field}" must be a string`);
  }
  const code = value.trim().toUpperCase();
  if (!CURRENCY_SHAPE.test(code)) {
    throw new BadRequestError(`"${field}" must be a 3-letter ISO 4217 code (e.g. "INR")`);
  }
  return code;
};

// Accept a client-supplied UUID (invoices and customers carry ids the device generated
// offline). Any RFC-4122 version is fine — the client library decides. Returns undefined
// when absent, so the repository falls back to a server-generated id.
const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const optionalUuid = (value: unknown, field = "id"): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !UUID_SHAPE.test(value)) {
    throw new BadRequestError(`"${field}" must be a valid UUID`);
  }
  return value.toLowerCase();
};

// The GST state code is two digits in the assigned 01-38 range. Optional; absent =>
// undefined, explicit null => null (clear).
export const optionalStateCode = (
  value: unknown,
  field = "stateCode"
): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new BadRequestError(`"${field}" must be a string or null`);
  }
  const code = value.trim();
  if (code.length === 0) return null;
  if (!/^[0-3][0-9]$/.test(code) || Number(code) < 1 || Number(code) > 38) {
    throw new BadRequestError(`"${field}" must be a 2-digit GST state code (01-38)`);
  }
  return code;
};
