import { DiscountType, Invoice, InvoiceItem, InvoiceStatus, Prisma } from "@prisma/client";
import { BadRequestError } from "../../../common/errors/AppError";
import { optionalCurrency, optionalString, requireString } from "../../../common/validation";
import {
  MoneyDiscountInput,
  MoneyLineInput,
  deriveGstSplit,
} from "../../../common/money";

// ---- parsing helpers ---------------------------------------------------------------

// A non-negative integer number of paise, sent as a string or number. Bounded to a safe JS
// integer: money flows through the decimal→number→BigInt path, and a value above 2^53 would
// silently lose precision there (and again in the number-based GST split). MAX_SAFE_INTEGER
// paise is ~₹90 trillion — far beyond any real invoice line.
const parsePaise = (value: unknown, field: string): number => {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
    throw new BadRequestError(`"${field}" must be a non-negative integer number of paise`);
  }
  if (n > Number.MAX_SAFE_INTEGER) {
    throw new BadRequestError(`"${field}" is too large`);
  }
  return n;
};

// A non-negative decimal string (quantity, tax rate), returned canonicalized. Length-capped so
// a pathological million-digit string can't drive heavy decimal arithmetic, and so line
// products stay in the safe-integer range.
const MAX_DECIMAL_LEN = 30;
const parseDecimal = (value: unknown, field: string): string => {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (text.length > MAX_DECIMAL_LEN) {
    throw new BadRequestError(`"${field}" is too long`);
  }
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new BadRequestError(`"${field}" must be a non-negative decimal (e.g. "2.5")`);
  }
  return text;
};

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

// A customer/company snapshot: a JSON object, size-capped so a client can't store megabytes of
// arbitrary nested JSON per invoice (only a handful of shallow fields are ever read).
const MAX_SNAPSHOT_BYTES = 8 * 1024;
const parseSnapshot = (value: unknown, field: string): Prisma.InputJsonValue | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestError(`"${field}" must be a JSON object`);
  }
  if (JSON.stringify(value).length > MAX_SNAPSHOT_BYTES) {
    throw new BadRequestError(`"${field}" is too large`);
  }
  return value as Prisma.InputJsonValue;
};

// ---- parsed input types ------------------------------------------------------------

export interface ParsedInvoiceItem {
  position: number;
  description: string;
  hsnSac: string | null;
  quantity: string;
  unitPrice: number; // paise
  taxRatePercent: string;
}

export interface ParsedInvoiceInput {
  id: string | undefined; // client-supplied uuid (optional; server generates if absent)
  data: {
    customerId: string | null;
    customerSnapshot: Prisma.InputJsonValue | undefined;
    companySnapshot: Prisma.InputJsonValue | undefined;
    invoiceNumber: string;
    invoiceDate: Date;
    dueDate: Date | null;
    currency: string;
    status: InvoiceStatus;
    templateId: string;
    templateVersion: number;
    notes: string | null;
    discountType: DiscountType | null;
    discountValue: string | null; // percent, or paise for Flat
    discountBeforeTax: boolean;
    updatedAt: Date;
    deletedAt: Date | null;
  };
  items: ParsedInvoiceItem[];
  // Derived inputs to the money module.
  moneyItems: MoneyLineInput[];
  discount: MoneyDiscountInput | null;
}

const parseItems = (raw: unknown): { items: ParsedInvoiceItem[]; money: MoneyLineInput[] } => {
  if (!Array.isArray(raw)) throw new BadRequestError('"items" must be an array');
  if (raw.length > 500) throw new BadRequestError("an invoice may have at most 500 items");
  const items: ParsedInvoiceItem[] = [];
  const money: MoneyLineInput[] = [];
  raw.forEach((r, i) => {
    if (typeof r !== "object" || r === null) throw new BadRequestError(`items[${i}] must be an object`);
    const item = r as Record<string, unknown>;
    const quantity = parseDecimal(item.quantity, `items[${i}].quantity`);
    const unitPrice = parsePaise(item.unitPrice, `items[${i}].unitPrice`);
    const taxRatePercent = item.taxRatePercent === undefined || item.taxRatePercent === null
      ? "0"
      : parseDecimal(item.taxRatePercent, `items[${i}].taxRatePercent`);
    items.push({
      // position defaults to array order, so the client's ordering is preserved without it
      // having to send explicit positions.
      position: typeof item.position === "number" ? item.position : i,
      description: requireString(item.description, `items[${i}].description`, 500),
      hsnSac: optionalString(item.hsnSac, `items[${i}].hsnSac`, 40) ?? null,
      quantity,
      unitPrice,
      taxRatePercent,
    });
    money.push({ quantity, unitPrice, taxRatePercent });
  });
  return { items, money };
};

const parseDiscount = (
  body: Record<string, unknown>
): { type: DiscountType | null; value: string | null; money: MoneyDiscountInput | null } => {
  const rawType = body.discountType;
  if (rawType === undefined || rawType === null) return { type: null, value: null, money: null };
  if (rawType !== "Flat" && rawType !== "Percentage") {
    throw new BadRequestError('"discountType" must be "Flat" or "Percentage"');
  }
  const value = parseDecimal(body.discountValue, "discountValue");
  return { type: rawType, value, money: { type: rawType, value } };
};

// Parse a create/upsert body (the full invoice the client holds).
export const parseInvoiceInput = (
  body: Record<string, unknown>,
  clientId: string | undefined
): ParsedInvoiceInput => {
  const { items, money } = parseItems(body.items);
  const discount = parseDiscount(body);

  return {
    id: clientId,
    data: {
      customerId: optionalString(body.customerId, "customerId", 64) ?? null,
      customerSnapshot: parseSnapshot(body.customerSnapshot, "customerSnapshot"),
      companySnapshot: parseSnapshot(body.companySnapshot, "companySnapshot"),
      invoiceNumber: requireString(body.invoiceNumber, "invoiceNumber", 60),
      invoiceDate: parseDate(body.invoiceDate, "invoiceDate"),
      dueDate: parseOptionalDate(body.dueDate, "dueDate"),
      currency: optionalCurrency(body.currency, "currency") ?? "INR",
      status: parseStatus(body.status),
      templateId: requireString(body.templateId, "templateId", 60),
      templateVersion: parsePositiveInt(body.templateVersion, "templateVersion"),
      notes: optionalString(body.notes, "notes", 5000) ?? null,
      discountType: discount.type,
      discountValue: discount.value,
      discountBeforeTax: body.discountBeforeTax === undefined ? true : body.discountBeforeTax === true,
      // Client-controlled edit time (LWW key). Falls back to now() when the client omits it.
      updatedAt: body.updatedAt ? parseDate(body.updatedAt, "updatedAt") : new Date(),
      deletedAt: parseOptionalDate(body.deletedAt, "deletedAt"),
    },
    items,
    moneyItems: money,
    discount: discount.money,
  };
};

const parsePositiveInt = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new BadRequestError(`"${field}" must be a positive integer`);
  }
  return value;
};

/// A partial update. Deliberately excludes items/discount/totals — changing money goes through
/// the full upsert (POST), which recomputes. PATCH is for quick scalar edits (mark Paid, add a
/// note, set the client's pdfPath).
export interface InvoicePatch {
  status?: InvoiceStatus;
  notes?: string | null;
  dueDate?: Date | null;
  pdfPath?: string | null;
  invoiceDate?: Date;
  invoiceNumber?: string;
  currency?: string;
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
  if ("notes" in body) patch.notes = optionalString(body.notes, "notes", 5000) ?? null;
  if ("dueDate" in body) patch.dueDate = parseOptionalDate(body.dueDate, "dueDate");
  if ("pdfPath" in body) patch.pdfPath = optionalString(body.pdfPath, "pdfPath", 1000) ?? null;
  if ("invoiceDate" in body) patch.invoiceDate = parseDate(body.invoiceDate, "invoiceDate");
  if ("invoiceNumber" in body) patch.invoiceNumber = requireString(body.invoiceNumber, "invoiceNumber", 60);
  if ("currency" in body) patch.currency = optionalCurrency(body.currency, "currency");
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

// ---- output mapping ----------------------------------------------------------------

const paise = (b: bigint): string => b.toString();

const stateCodeOf = (snapshot: Prisma.JsonValue | null): string | null => {
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    const v = (snapshot as Record<string, unknown>).stateCode;
    return typeof v === "string" ? v : null;
  }
  return null;
};

export interface InvoiceItemDto {
  id: string;
  position: number;
  description: string;
  hsnSac: string | null;
  quantity: string;
  unitPrice: string; // paise
  taxRatePercent: string;
  taxAmount: string; // paise
  lineTotal: string; // paise
}

export interface InvoiceDto {
  id: string;
  customerId: string | null;
  customerSnapshot: Prisma.JsonValue | null;
  companySnapshot: Prisma.JsonValue | null;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  currency: string;
  status: InvoiceStatus;
  templateId: string;
  templateVersion: number;
  notes: string | null;
  discountType: DiscountType | null;
  discountValue: string | null;
  discountBeforeTax: boolean;
  // Money — all integer paise as strings (server-authoritative).
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  // Derived, presentation-only.
  gstSplit: { intraState: boolean; cgst: string; sgst: string; igst: string };
  pdfPath: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: InvoiceItemDto[];
}

type InvoiceWithItems = Invoice & { items: InvoiceItem[] };

export const toInvoiceDto = (inv: InvoiceWithItems): InvoiceDto => {
  const split = deriveGstSplit(
    Number(inv.taxTotal),
    stateCodeOf(inv.companySnapshot),
    stateCodeOf(inv.customerSnapshot)
  );
  const items = [...inv.items]
    .sort((a, b) => a.position - b.position)
    .map((it) => ({
      id: it.id,
      position: it.position,
      description: it.description,
      hsnSac: it.hsnSac,
      quantity: it.quantity.toString(),
      unitPrice: paise(it.unitPrice),
      taxRatePercent: it.taxRatePercent.toString(),
      taxAmount: paise(it.taxAmount),
      lineTotal: paise(it.lineTotal),
    }));

  return {
    id: inv.id,
    customerId: inv.customerId,
    customerSnapshot: inv.customerSnapshot,
    companySnapshot: inv.companySnapshot,
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.invoiceDate.toISOString(),
    dueDate: inv.dueDate ? inv.dueDate.toISOString() : null,
    currency: inv.currency,
    status: inv.status,
    templateId: inv.templateId,
    templateVersion: inv.templateVersion,
    notes: inv.notes,
    discountType: inv.discountType,
    discountValue: inv.discountValue ? inv.discountValue.toString() : null,
    discountBeforeTax: inv.discountBeforeTax,
    subtotal: paise(inv.subtotal),
    discountTotal: paise(inv.discountTotal),
    taxTotal: paise(inv.taxTotal),
    grandTotal: paise(inv.grandTotal),
    gstSplit: {
      intraState: split.intraState,
      cgst: String(split.cgst),
      sgst: String(split.sgst),
      igst: String(split.igst),
    },
    pdfPath: inv.pdfPath,
    deletedAt: inv.deletedAt ? inv.deletedAt.toISOString() : null,
    createdAt: inv.createdAt.toISOString(),
    updatedAt: inv.updatedAt.toISOString(),
    items,
  };
};
