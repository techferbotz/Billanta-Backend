import { Company } from "@prisma/client";
import { parseValuesOr400 } from "../../../common/values";
import { Values, storedValues } from "../../../fields/values";

/// The business profile as clients see it: company_* field id -> value (docs/FIELDS.md §7.2).
export interface CompanyDto {
  values: Values;
  createdAt: string;
  updatedAt: string;
}

export const toCompanyDto = (c: Company): CompanyDto => ({
  values: storedValues(c.values),
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

const OWNERS = ["company"] as const;

/// PUT /company — the whole profile. An omitted field is cleared.
export const parseCompanyPut = (body: Record<string, unknown>): Values =>
  parseValuesOr400(body.values, "values", { owners: OWNERS, patch: false });

/// PATCH /company — a merge: a key set to null is cleared, an absent key is untouched. This is
/// what an invoice editor sends when the user edits a company field inside an invoice.
export const parseCompanyPatch = (body: Record<string, unknown>): Values =>
  parseValuesOr400(body.values, "values", { owners: OWNERS, patch: true });
