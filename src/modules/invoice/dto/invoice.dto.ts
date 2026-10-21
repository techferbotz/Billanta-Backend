import { randomUUID } from "node:crypto";
import { Invoice, InvoiceItem, InvoiceStatus, Prisma } from "@prisma/client";
import { BadRequestError } from "../../../common/errors/AppError";
import { optionalString, optionalUuid, requireString } from "../../../common/validation";
import { parseValuesOr400 } from "../../../common/values";
import { MoneyDiscountInput, MoneyLineInput, deriveGstSplit } from "../../../common/money";
import {
  MAX_LINE_ITEMS,
  MAX_LINE_VALUES_BYTES,
  Values,
  storedValues,
  stringValue,
} from "../../../fields/values";

// The invoice wire shape (docs/FIELDS.md §7.6): `values` holds the invoice fields plus this
// invoice's copy of the company and customer fields; `lineItems` holds the lines, each with its
// own values. Money inputs inside those maps are validated strictly by parseValues (§7.7); the
// totals are always recomputed here, never trusted from the client.

// ---- parsing helpers ---------------------------------------------------------------

const parseDate = (value: unknown, field: string): Date => {
  if (typeof value !== "string" && !(value instanceof Date)) {
    throw new BadRequestError(`"${field}" is required and must be an ISO date string`);
  }
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) throw new BadRequestError(`"${field}" is not a valid date`);
  return d;
};

const parseOptionalDate = (value: unknown, field: string): Date | null => {
  if (value === undefined || value === null || value === "") return null;
  return parseDate(value, field);
};

const parseStatus = (value: unknown): InvoiceStatus => {
  if (value === undefined || value === null) return InvoiceStatus.Draft;
  if (value === "Draft" || value === "Pending" || value === "Paid") return value;
  throw new BadRequestError('"status" must be one of Draft, Pending, Paid');
};

const parsePositiveInt = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new BadRequestError(`"${field}" must be a positive integer`);
  }
  return value;
};

// themeOverrides: an opaque JSON object mapping a template theme-token name to a hex colour. The
// server validates only "is an object" plus a small size cap — the colours and token names are
// entirely the app's concern (APP-003). Absent/null => undefined (stored as JSON null = "use the
// template's default colours").
const MAX_THEME_BYTES = 2 * 1024;
const parseThemeOverrides = (value: unknown, field: string): Prisma.InputJsonValue | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestError(`"${field}" must be a JSON object`);
  }
  if (JSON.stringify(value).length > MAX_THEME_BYTES) {
    throw new BadRequestError(`"${field}" is too large`);
  }
  return value as Prisma.InputJsonValue;
};

// hiddenSections: an array of short section-id strings the app wants hidden. Validated as an array
// of ≤64-char strings with a count cap; the ids' meaning is the app's. Absent/null => undefined.
const MAX_HIDDEN_SECTIONS = 50;
const parseHiddenSections = (value: unknown, field: string): Prisma.InputJsonValue | undefined => {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new BadRequestError(`"${field}" must be an array of strings`);
  if (value.length > MAX_HIDDEN_SECTIONS) {
    throw new BadRequestError(`"${field}" has too many entries`);
  }
  value.forEach((v, i) => {
    if (typeof v !== "string" || v.length > 64) {
      throw new BadRequestError(`"${field}[${i}]" must be a string of at most 64 characters`);
    }
  });
  return value as Prisma.InputJsonValue;
};

// An invoice's values: its own fields plus its copy of the company and customer fields. The lines
// travel separately, in `lineItems` — parseValues rejects `line_items` as a value.
const INVOICE_OWNERS = ["invoice", "company", "customer"] as const;
const parseInvoiceValues = (raw: unknown, field: string, patch: boolean): Values =>
  parseValuesOr400(raw, field, { owners: INVOICE_OWNERS, patch });

// ---- parsed input types ------------------------------------------------------------

export interface ParsedLine {
  lineId: string;
  values: Values;
}

export interface ParsedInvoiceInput {
  id: string | undefined; // client-supplied uuid (optional; server generates if absent)
  status: InvoiceStatus;
  templateId: string;
  templateVersion: number;
  values: Values;
  lines: ParsedLine[];
  themeOverrides: Prisma.InputJsonValue | undefined;
  hiddenSections: Prisma.InputJsonValue | undefined;
  pdfPath: string | null | undefined; // undefined = leave as stored
  updatedAt: Date;
  deletedAt: Date | null;
}

const parseLines = (raw: unknown): ParsedLine[] => {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new BadRequestError('"lineItems" must be an array');
  if (raw.length > MAX_LINE_ITEMS) {
    throw new BadRequestError(`an invoice may have at most ${MAX_LINE_ITEMS} line items`);
  }
  const seen = new Set<string>();
  return raw.map((r, i) => {
    if (typeof r !== "object" || r === null || Array.isArray(r)) {
      throw new BadRequestError(`lineItems[${i}] must be an object`);
    }
    const line = r as Record<string, unknown>;
    // The client's own line id; one is minted when absent so every stored line has one.
    const lineId = optionalUuid(line.id, `lineItems[${i}].id`) ?? randomUUID();
    if (seen.has(lineId)) throw new BadRequestError(`lineItems[${i}].id repeats another line's id`);
    seen.add(lineId);
    const values = parseValuesOr400(line.values, `lineItems[${i}].values`, {
      owners: ["line"],
      patch: false,
      maxBytes: MAX_LINE_VALUES_BYTES,
    });
    return { lineId, values };
  });
};

// Parse a create/upsert body (the full invoice the client holds).
export const parseInvoiceInput = (
  body: Record<string, unknown>,
  clientId: string | undefined
): ParsedInvoiceInput => ({
  id: clientId,
  status: parseStatus(body.status),
  templateId: requireString(body.templateId, "templateId", 60),
  templateVersion: parsePositiveInt(body.templateVersion, "templateVersion"),
  values: parseInvoiceValues(body.values, "values", false),
  lines: parseLines(body.lineItems),
  themeOverrides: parseThemeOverrides(body.themeOverrides, "themeOverrides"),
  hiddenSections: parseHiddenSections(body.hiddenSections, "hiddenSections"),
  pdfPath: "pdfPath" in body ? optionalString(body.pdfPath, "pdfPath", 1000) ?? null : undefined,
  // Client-controlled edit time (LWW key). Falls back to now() when the client omits it.
  updatedAt: body.updatedAt ? parseDate(body.updatedAt, "updatedAt") : new Date(),
  deletedAt: parseOptionalDate(body.deletedAt, "deletedAt"),
});

/// A partial update: status, the client's pdfPath, and/or a merge into `values`. Lines change only
/// through the full upsert (POST). A values patch that touches a money input (discount, currency)
/// is recomputed like any write.
export interface InvoicePatch {
  status?: InvoiceStatus;
  pdfPath?: string | null;
  values?: Values; // a merge patch: null clears a key
  updatedAt: Date; // always bumped
}

export const parseInvoicePatch = (body: Record<string, unknown>): InvoicePatch => {
  const patch: InvoicePatch = {
    updatedAt: body.updatedAt ? parseDate(body.updatedAt, "updatedAt") : new Date(),
  };
  // For PATCH, treat an explicit null the same as absent (leave unchanged). Without this,
  // parseStatus(null) coerces to Draft, so a client library that serializes an unset field as
  // `"status": null` (common on Android) would silently downgrade a Paid invoice to Draft.
  if ("status" in body && body.status !== null) patch.status = parseStatus(body.status);
  if ("pdfPath" in body) patch.pdfPath = optionalString(body.pdfPath, "pdfPath", 1000) ?? null;
  if ("values" in body && body.values !== null) patch.values = parseInvoiceValues(body.values, "values", true);
  return patch;
};

/**
 * The deletion time for DELETE /invoices/:id — the client's edit-time when supplied (so the
 * tombstone's updatedAt stays in the same client clock domain as edits and the sync cursor),
 * else now(). The soft-delete then keeps updatedAt monotonic so the tombstone can't sink below a
 * sync cursor already issued to another device.
 */
export const parseDeleteTime = (body: Record<string, unknown>): Date =>
  body.updatedAt ? parseDate(body.updatedAt, "updatedAt") : new Date();

// ---- money inputs ------------------------------------------------------------------

/// The money module's inputs, read from the (already validated) values: a missing input uses its
/// "if absent" value from docs/FIELDS.md §7.7, so an empty draft still totals to zero.
export const moneyInputsOf = (
  values: Values,
  lines: Values[]
): { lines: MoneyLineInput[]; discount: MoneyDiscountInput | null; discountBeforeTax: boolean } => {
  const moneyLines = lines.map((v) => ({
    quantity: stringValue(v, "quantity") ?? "0",
    unitPrice: Number(stringValue(v, "unit_price") ?? "0"),
    taxRatePercent: stringValue(v, "tax_rate") ?? "0",
  }));
  const d = values.discount as { kind: "flat" | "percent"; value: string; beforeTax?: boolean } | undefined;
  return {
    lines: moneyLines,
    discount: d ? { type: d.kind === "flat" ? "Flat" : "Percentage", value: d.value } : null,
    discountBeforeTax: d?.beforeTax ?? true,
  };
};

/// The columns derived from `values` for search and uniqueness. A deleted invoice releases its
/// number, so the per-user unique index only binds live invoices.
export const derivedColumnsOf = (values: Values, deleted: boolean) => ({
  invoiceNumber: deleted ? null : stringValue(values, "invoice_number"),
  customerName: stringValue(values, "customer_name"),
  customerPhone: stringValue(values, "customer_phone"),
});

// ---- output mapping ----------------------------------------------------------------

const paise = (b: bigint): string => b.toString();

export interface InvoiceLineDto {
  id: string;
  values: Values;
  computed: { line_total: string; tax_amount: string }; // paise
}

export interface InvoiceDto {
  id: string;
  templateId: string;
  templateVersion: number;
  status: InvoiceStatus;
  values: Values;
  lineItems: InvoiceLineDto[];
  // Server-authoritative totals, paise as strings, keyed by their computed field ids.
  computed: {
    subtotal: string;
    discount_total: string;
    tax_total: string;
    cgst_total: string;
    sgst_total: string;
    igst_total: string;
    grand_total: string;
  };
  // Template customisation, echoed verbatim (opaque to the server). Null = template defaults.
  themeOverrides: Prisma.JsonValue | null;
  hiddenSections: Prisma.JsonValue | null;
  pdfPath: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type InvoiceWithItems = Invoice & { items: InvoiceItem[] };

export const toInvoiceDto = (inv: InvoiceWithItems): InvoiceDto => {
  const values = storedValues(inv.values);
  // CGST+SGST within one state, IGST across states (or when either state is unknown).
  const split = deriveGstSplit(
    Number(inv.taxTotal),
    stringValue(values, "company_state"),
    stringValue(values, "customer_state")
  );
  const lineItems = [...inv.items]
    .sort((a, b) => a.position - b.position)
    .map((it) => ({
      id: it.lineId,
      values: storedValues(it.values),
      computed: { line_total: paise(it.lineTotal), tax_amount: paise(it.taxAmount) },
    }));

  return {
    id: inv.id,
    templateId: inv.templateId,
    templateVersion: inv.templateVersion,
    status: inv.status,
    values,
    lineItems,
    computed: {
      subtotal: paise(inv.subtotal),
      discount_total: paise(inv.discountTotal),
      tax_total: paise(inv.taxTotal),
      cgst_total: String(split.cgst),
      sgst_total: String(split.sgst),
      igst_total: String(split.igst),
      grand_total: paise(inv.grandTotal),
    },
    themeOverrides: inv.themeOverrides,
    hiddenSections: inv.hiddenSections,
    pdfPath: inv.pdfPath,
    deletedAt: inv.deletedAt ? inv.deletedAt.toISOString() : null,
    createdAt: inv.createdAt.toISOString(),
    updatedAt: inv.updatedAt.toISOString(),
  };
};
