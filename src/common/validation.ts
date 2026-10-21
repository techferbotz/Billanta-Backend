import { BadRequestError } from "./errors/AppError";

// Small, shared input validators. Controllers use these to check the SHAPE of a request
// before handing it to a service — business rules stay in the service layer. Record data
// (company, customer, product, settings, invoice) is a values map, checked by fields/values.ts.

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

// Accept a client-supplied UUID (invoices, lines, customers and products carry ids the device
// generated offline). Any RFC-4122 version is fine — the client library decides. Returns
// undefined when absent, so the caller falls back to a server-generated id.
const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const optionalUuid = (value: unknown, field = "id"): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !UUID_SHAPE.test(value)) {
    throw new BadRequestError(`"${field}" must be a valid UUID`);
  }
  return value.toLowerCase();
};
