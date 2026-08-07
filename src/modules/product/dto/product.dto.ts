import { Product } from "@prisma/client";
import { BadRequestError } from "../../../common/errors/AppError";
import { optionalString, requireString } from "../../../common/validation";

/// A product as clients see it. `unitPrice` is an integer number of paise as a string, like every
/// monetary field on the wire; `taxRatePercent` is a decimal string.
export interface ProductDto {
  id: string;
  name: string;
  hsnSac: string | null;
  unitPrice: string; // paise
  taxRatePercent: string;
  unit: string | null;
  createdAt: string;
  updatedAt: string;
}

/// Full write payload for POST (create or, on a repeated id, full replace). Optional text fields
/// are stored as null when omitted — the same full-replace contract as Customer.
export interface ProductWriteData {
  name: string;
  hsnSac: string | null;
  unitPrice: bigint; // paise
  taxRatePercent: string;
  unit: string | null;
}

/// Partial payload for PATCH — only keys the client actually sent appear, so an absent key leaves
/// that column unchanged while an explicit null clears a nullable one.
export type ProductPatchData = Partial<ProductWriteData>;

// A non-negative integer number of paise, sent as a string or number, returned as a BigInt.
// Bounded to a safe JS integer — mirrors the invoice-item unitPrice parser so a product's rate and
// a line's rate validate identically. (~₹90 trillion cap; far beyond any real price.)
const parsePaise = (value: unknown, field: string): bigint => {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
    throw new BadRequestError(`"${field}" must be a non-negative integer number of paise`);
  }
  if (n > Number.MAX_SAFE_INTEGER) {
    throw new BadRequestError(`"${field}" is too large`);
  }
  return BigInt(n);
};

// A non-negative decimal string (the tax rate), length-capped and canonicalized. Accepts a number
// or a numeric string so the client can replay exactly what it received.
const MAX_DECIMAL_LEN = 30;
const parseDecimal = (value: unknown, field: string): string => {
  const text =
    typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (text.length > MAX_DECIMAL_LEN) throw new BadRequestError(`"${field}" is too long`);
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new BadRequestError(`"${field}" must be a non-negative decimal (e.g. "18")`);
  }
  return text;
};

export const toProductDto = (p: Product): ProductDto => ({
  id: p.id,
  name: p.name,
  hsnSac: p.hsnSac,
  unitPrice: p.unitPrice.toString(),
  taxRatePercent: p.taxRatePercent.toString(),
  unit: p.unit,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

// Full-replace parse for POST /products.
export const parseCreateProductBody = (body: Record<string, unknown>): ProductWriteData => ({
  name: requireString(body.name, "name", 200),
  hsnSac: optionalString(body.hsnSac, "hsnSac", 40) ?? null,
  // Absent/null unitPrice defaults to 0 paise (a product whose rate isn't set yet).
  unitPrice: parsePaise(body.unitPrice ?? 0, "unitPrice"),
  taxRatePercent:
    body.taxRatePercent === undefined || body.taxRatePercent === null
      ? "0"
      : parseDecimal(body.taxRatePercent, "taxRatePercent"),
  unit: optionalString(body.unit, "unit", 40) ?? null,
});

// Partial parse for PATCH /products/:id — only sets keys the client sent.
export const parsePatchProductBody = (body: Record<string, unknown>): ProductPatchData => {
  const data: ProductPatchData = {};
  if ("name" in body) data.name = requireString(body.name, "name", 200);
  if ("hsnSac" in body) data.hsnSac = optionalString(body.hsnSac, "hsnSac", 40) ?? null;
  if ("unitPrice" in body) data.unitPrice = parsePaise(body.unitPrice, "unitPrice");
  if ("taxRatePercent" in body) data.taxRatePercent = parseDecimal(body.taxRatePercent, "taxRatePercent");
  if ("unit" in body) data.unit = optionalString(body.unit, "unit", 40) ?? null;
  return data;
};
