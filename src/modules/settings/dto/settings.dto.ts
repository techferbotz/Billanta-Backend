import { Settings } from "@prisma/client";
import { BadRequestError } from "../../../common/errors/AppError";
import {
  optionalCurrency,
  optionalDecimalString,
  optionalNumber,
  optionalString,
} from "../../../common/validation";

/// Per-user defaults for the new-invoice screen.
///
/// `defaultTaxPercent` is serialized as a STRING, not a number: it is a Prisma `Decimal`,
/// and stringifying preserves the exact value the user entered (e.g. "2.5") without a
/// float round-trip. The write side accepts that same string back (see parseSettingsBody),
/// so the object the client GETs can be PUT verbatim. Every rate/amount that crosses the
/// wire in this app follows the same rule — see docs/MONEY.md (Phase 5).
export interface SettingsDto {
  id: string;
  defaultCurrency: string;
  defaultTaxPercent: string | null;
  invoiceNumberPrefix: string | null;
  nextInvoiceNumber: number | null;
  defaultTemplateId: string | null;
  defaultNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

/// Write payload for PUT /settings. Unlike Company (a cohesive document, full-replace),
/// Settings is a bag of independent preferences, so PUT is a MERGE: only keys the client
/// actually sent are written. This is deliberate — it stops an omitted field from silently
/// wiping something durable, most importantly the running `nextInvoiceNumber` counter. An
/// explicit null still clears a field. `defaultTaxPercent` is kept as a string so it
/// reaches the Decimal column exactly.
export type SettingsWriteData = Partial<{
  defaultCurrency: string;
  defaultTaxPercent: string | null;
  invoiceNumberPrefix: string | null;
  nextInvoiceNumber: number | null;
  defaultTemplateId: string | null;
  defaultNotes: string | null;
}>;

export const toSettingsDto = (s: Settings): SettingsDto => ({
  id: s.id,
  defaultCurrency: s.defaultCurrency,
  // Prisma Decimal | null -> exact string | null.
  defaultTaxPercent: s.defaultTaxPercent === null ? null : s.defaultTaxPercent.toString(),
  invoiceNumberPrefix: s.invoiceNumberPrefix,
  nextInvoiceNumber: s.nextInvoiceNumber,
  defaultTemplateId: s.defaultTemplateId,
  defaultNotes: s.defaultNotes,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

/**
 * Parse and validate a PUT /settings body into a MERGE payload — only keys the client sent
 * appear, so an omitted field is left unchanged while an explicit null clears it.
 *
 * `defaultTaxPercent` accepts a number or a numeric string (in [0,100]) and is stored as a
 * string. `nextInvoiceNumber` is a positive integer suggestion only — NOT the uniqueness
 * source of truth (that's the per-user unique on Invoice in Phase 5), so two offline
 * devices sharing a value is fine and is resolved at sync time.
 */
export const parseSettingsBody = (body: Record<string, unknown>): SettingsWriteData => {
  const data: SettingsWriteData = {};

  if ("defaultCurrency" in body) {
    // Currency is NOT NULL in the schema; a present-but-null/blank value falls back to INR.
    data.defaultCurrency = optionalCurrency(body.defaultCurrency, "defaultCurrency") ?? "INR";
  }
  if ("defaultTaxPercent" in body) {
    data.defaultTaxPercent =
      optionalDecimalString(body.defaultTaxPercent, "defaultTaxPercent", { min: 0, max: 100 }) ??
      null;
  }
  if ("invoiceNumberPrefix" in body) {
    data.invoiceNumberPrefix = optionalString(body.invoiceNumberPrefix, "invoiceNumberPrefix", 20) ?? null;
  }
  if ("nextInvoiceNumber" in body) {
    const n = optionalNumber(body.nextInvoiceNumber, "nextInvoiceNumber", { min: 1 });
    if (n != null && !Number.isInteger(n)) {
      throw new BadRequestError('"nextInvoiceNumber" must be a whole number');
    }
    data.nextInvoiceNumber = n ?? null;
  }
  if ("defaultTemplateId" in body) {
    data.defaultTemplateId = optionalString(body.defaultTemplateId, "defaultTemplateId", 100) ?? null;
  }
  if ("defaultNotes" in body) {
    data.defaultNotes = optionalString(body.defaultNotes, "defaultNotes", 2000) ?? null;
  }

  return data;
};
