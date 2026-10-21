import { Product } from "@prisma/client";
import { BadRequestError } from "../../../common/errors/AppError";
import { parseValuesOr400 } from "../../../common/values";
import { Values, storedValues } from "../../../fields/values";

/// A product as clients see it: line field id -> value (docs/FIELDS.md §7.5). The ids are the
/// line-item ones (description, image, hsn_sac, unit, unit_price, tax_rate), so picking a product
/// copies its values straight into a line. `unit_price` is paise as a string, like all money.
export interface ProductDto {
  id: string;
  values: Values;
  createdAt: string;
  updatedAt: string;
}

export const toProductDto = (p: Product): ProductDto => ({
  id: p.id,
  values: storedValues(p.values),
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

const OWNERS = ["line"] as const;

// A product has no quantity — that belongs to the line the product is added to.
const rejectQuantity = (values: Values): Values => {
  if ("quantity" in values) throw new BadRequestError('"values.quantity" can\'t be stored on a product');
  return values;
};

/// POST /products — the whole product (create, or full replace on a repeated id).
export const parseProductValues = (body: Record<string, unknown>): Values =>
  rejectQuantity(parseValuesOr400(body.values, "values", { owners: OWNERS, patch: false }));

/// PATCH /products/:id — a merge: null clears a key, an absent key is untouched.
export const parseProductPatch = (body: Record<string, unknown>): Values =>
  rejectQuantity(parseValuesOr400(body.values, "values", { owners: OWNERS, patch: true }));
