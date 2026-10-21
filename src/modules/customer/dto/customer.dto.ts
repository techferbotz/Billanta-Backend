import { Customer } from "@prisma/client";
import { parseValuesOr400 } from "../../../common/values";
import { Values, storedValues } from "../../../fields/values";

/// A customer as clients see them: customer_* field id -> value (docs/FIELDS.md §7.4).
export interface CustomerDto {
  id: string;
  values: Values;
  createdAt: string;
  updatedAt: string;
}

export const toCustomerDto = (c: Customer): CustomerDto => ({
  id: c.id,
  values: storedValues(c.values),
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

const OWNERS = ["customer"] as const;

/// POST /customers — the whole customer (create, or full replace on a repeated id).
export const parseCustomerValues = (body: Record<string, unknown>): Values =>
  parseValuesOr400(body.values, "values", { owners: OWNERS, patch: false });

/// PATCH /customers/:id — a merge: null clears a key, an absent key is untouched. This is what an
/// invoice editor sends when the user edits a customer field inside an invoice.
export const parseCustomerPatch = (body: Record<string, unknown>): Values =>
  parseValuesOr400(body.values, "values", { owners: OWNERS, patch: true });
