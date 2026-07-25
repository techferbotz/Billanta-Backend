import { Request, Response } from "express";
import { sendSuccess } from "../../../common/response/apiResponse";
import { BadRequestError } from "../../../common/errors/AppError";
import { getUserId } from "../../../common/utils/getUserId";
import { parsePagination } from "../../../common/pagination";
import { AppError } from "../../../common/errors/AppError";
import { optionalUuid, requireObjectBody } from "../../../common/validation";
import { invoiceService, InvoiceStatusFilter } from "../service/invoice.service";
import { parseInvoiceInput, parseInvoicePatch, ParsedInvoiceInput } from "../dto/invoice.dto";
import { decodeSyncCursor } from "../syncCursor";

const parseStatusFilter = (raw: unknown): InvoiceStatusFilter | undefined => {
  if (raw === undefined || raw === "") return undefined;
  if (raw === "Draft" || raw === "Pending" || raw === "Paid") return raw;
  throw new BadRequestError('"status" must be one of Draft, Pending, Paid');
};

// POST /invoices — create or (with a client uuid) idempotently replace. Totals are recomputed.
export const createInvoice = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const body = requireObjectBody(req.body);
  const id = optionalUuid(body.id, "id");
  const parsed = parseInvoiceInput(body, id);
  sendSuccess(res, await invoiceService.upsert(userId, parsed), 201);
};

// GET /invoices?limit&cursor&status&q
export const listInvoices = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const page = parsePagination(req);
  const status = parseStatusFilter(req.query.status);
  const rawQ = req.query.q;
  const q = typeof rawQ === "string" && rawQ.trim().length > 0 ? rawQ.trim() : undefined;
  sendSuccess(res, await invoiceService.list(userId, page, { status, q }));
};

// GET /invoices/:id
export const getInvoice = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  sendSuccess(res, await invoiceService.getById(getUserId(req), req.params.id));
};

// PATCH /invoices/:id — quick scalar edits (status, notes, dueDate, pdfPath, …).
export const patchInvoice = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const patch = parseInvoicePatch(requireObjectBody(req.body));
  sendSuccess(res, await invoiceService.patch(userId, req.params.id, patch));
};

// DELETE /invoices/:id — soft delete (a tombstone that syncs to other devices).
export const deleteInvoice = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  await invoiceService.delete(getUserId(req), req.params.id, new Date());
  sendSuccess(res);
};

// POST /invoices/sync — { invoices: [...], since? } -> { changed, conflicts, nextCursor, hasMore }
export const syncInvoices = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const body = requireObjectBody(req.body);

  if (!Array.isArray(body.invoices)) {
    throw new BadRequestError('"invoices" must be an array');
  }
  if (body.invoices.length > 500) {
    throw new BadRequestError("a sync batch may contain at most 500 invoices");
  }

  // Parse each push individually: a single malformed invoice must NOT fail the whole batch (an
  // offline device may carry schema-drifted rows). Parse failures become per-item conflicts.
  const pushes: ParsedInvoiceInput[] = [];
  const preRejected: { id: string; reason: string }[] = [];
  body.invoices.forEach((raw, i) => {
    if (typeof raw !== "object" || raw === null) {
      preRejected.push({ id: `(index ${i})`, reason: "invoice must be an object" });
      return;
    }
    const item = raw as Record<string, unknown>;
    try {
      const id = optionalUuid(item.id, `invoices[${i}].id`);
      if (!id) throw new BadRequestError(`invoices[${i}].id is required for sync`);
      pushes.push(parseInvoiceInput(item, id));
    } catch (err) {
      const id = typeof item.id === "string" ? item.id : `(index ${i})`;
      preRejected.push({ id, reason: err instanceof AppError ? err.message : "invalid invoice" });
    }
  });

  const cursor = decodeSyncCursor(body.since);

  sendSuccess(res, await invoiceService.sync(userId, pushes, cursor, preRejected));
};
