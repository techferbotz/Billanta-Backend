import { Prisma } from "@prisma/client";
import {
  invoiceRepository,
  InvoiceWithItems,
  InvoiceItemWriteData,
  InvoiceWriteData,
} from "../repository/invoice.repository";
import { PageParams, PaginatedResult } from "../../../common/pagination";
import { BadRequestError, ConflictError, NotFoundError } from "../../../common/errors/AppError";
import { calculateInvoice } from "../../../common/money";
import {
  InvoiceDto,
  InvoicePatch,
  ParsedInvoiceInput,
  toInvoiceDto,
} from "../dto/invoice.dto";
import { SyncCursor, encodeSyncCursor } from "../syncCursor";

// One sync pull returns at most this many changed invoices; `hasMore` tells the client to sync
// again with the returned cursor to drain the rest. Bounds the response for a first/lost-cursor
// pull over a huge history.
const SYNC_PULL_LIMIT = 200;

export interface SyncResult {
  changed: InvoiceDto[];
  conflicts: { id: string; reason: string }[];
  // Opaque keyset cursor to send back as `since` next time. Null only when the user has no
  // invoices at all.
  nextCursor: string | null;
  // True when more changes remain beyond this page — the client should sync again immediately.
  hasMore: boolean;
}

export class InvoiceService {
  /**
   * Create or replace an invoice. The server ALWAYS recomputes totals from the items and
   * stores its own values — the client's advisory totals are ignored — and returns them so a
   * client that computed differently can correct itself.
   */
  async upsert(userId: string, parsed: ParsedInvoiceInput): Promise<InvoiceDto> {
    const { data, items } = this.build(parsed);
    const inv = parsed.id
      ? await invoiceRepository.upsertOwn(userId, parsed.id, data, items)
      : await invoiceRepository.createNew(userId, data, items);
    return toInvoiceDto(inv);
  }

  async getById(userId: string, id: string): Promise<InvoiceDto> {
    const inv = await invoiceRepository.findByIdForUser(id, userId);
    if (!inv || inv.deletedAt) throw new NotFoundError("Invoice not found");
    return toInvoiceDto(inv);
  }

  async list(
    userId: string,
    page: PageParams,
    filters: { status?: InvoiceStatusFilter; q?: string }
  ): Promise<PaginatedResult<InvoiceDto>> {
    const result = await invoiceRepository.listForUser(userId, page, {
      status: filters.status ?? undefined,
      q: filters.q,
    });
    return { ...result, items: result.items.map(toInvoiceDto) };
  }

  async patch(userId: string, id: string, patch: InvoicePatch): Promise<InvoiceDto> {
    const update: Prisma.InvoiceUpdateInput = { updatedAt: patch.updatedAt };
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.notes !== undefined) update.notes = patch.notes;
    if (patch.dueDate !== undefined) update.dueDate = patch.dueDate;
    if (patch.pdfPath !== undefined) update.pdfPath = patch.pdfPath;
    if (patch.invoiceDate !== undefined) update.invoiceDate = patch.invoiceDate;
    if (patch.invoiceNumber !== undefined) update.invoiceNumber = patch.invoiceNumber;
    if (patch.currency !== undefined) update.currency = patch.currency;

    const inv = await invoiceRepository.patchOwn(userId, id, update, patch.invoiceNumber);
    if (!inv) throw new NotFoundError("Invoice not found");
    return toInvoiceDto(inv);
  }

  async delete(userId: string, id: string, when: Date): Promise<void> {
    const ok = await invoiceRepository.softDeleteOwn(userId, id, when);
    if (!ok) throw new NotFoundError("Invoice not found");
  }

  /**
   * Batch sync. Applies each pushed invoice with LAST-WRITE-WINS by updatedAt (the client's
   * edit time), then returns a BOUNDED page of everything changed since `cursor` — including
   * tombstones — so the caller reconciles. A push older than the server's copy is skipped; a
   * cross-user id or a duplicate invoice number is reported as a conflict without aborting the
   * batch. `preRejected` are pushes the controller couldn't even parse — surfaced as conflicts
   * here so one malformed invoice never fails the whole batch.
   */
  async sync(
    userId: string,
    pushes: ParsedInvoiceInput[],
    cursor: SyncCursor | null,
    preRejected: { id: string; reason: string }[] = []
  ): Promise<SyncResult> {
    const conflicts: { id: string; reason: string }[] = [...preRejected];

    for (const push of pushes) {
      const id = push.id;
      if (!id) {
        conflicts.push({ id: "(missing)", reason: "each synced invoice must carry an id" });
        continue;
      }
      const stamp = await invoiceRepository.findStamp(id);
      if (stamp && stamp.userId !== userId) {
        conflicts.push({ id, reason: "id belongs to another account" });
        continue;
      }
      // Last-write-wins: skip if the server's copy is the same age or newer.
      if (stamp && stamp.updatedAt.getTime() >= push.data.updatedAt.getTime()) {
        continue;
      }
      const { data, items } = this.build(push);
      try {
        await invoiceRepository.upsertOwn(userId, id, data, items);
      } catch (err) {
        if (err instanceof ConflictError) {
          conflicts.push({ id, reason: err.message });
        } else {
          throw err;
        }
      }
    }

    // Bounded keyset page of changes (cursor + filter share the client-updatedAt clock domain).
    const rows = await invoiceRepository.changedSince(userId, cursor, SYNC_PULL_LIMIT);
    const hasMore = rows.length > SYNC_PULL_LIMIT;
    const page = hasMore ? rows.slice(0, SYNC_PULL_LIMIT) : rows;

    const last = page[page.length - 1];
    const nextCursor = last
      ? encodeSyncCursor({ updatedAt: last.updatedAt, id: last.id })
      : cursor
        ? encodeSyncCursor(cursor) // nothing new: hold the client's position
        : null;

    return { changed: page.map(toInvoiceDto), conflicts, nextCursor, hasMore };
  }

  // Recompute totals from items and assemble the repository write payload.
  private build(parsed: ParsedInvoiceInput): {
    data: InvoiceWriteData;
    items: InvoiceItemWriteData[];
  } {
    const money = calculateInvoice(parsed.moneyItems, parsed.discount, {
      discountBeforeTax: parsed.data.discountBeforeTax,
    });

    // Guard against aggregate overflow: individual paise are bounded to a safe integer, but a
    // sum across many lines could still exceed it. If it does, refuse rather than store a
    // silently-imprecise BigInt.
    for (const total of [money.subtotal, money.discountTotal, money.taxTotal, money.grandTotal]) {
      if (total > Number.MAX_SAFE_INTEGER) {
        throw new BadRequestError("Invoice total exceeds the supported maximum");
      }
    }

    const data: InvoiceWriteData = {
      ...parsed.data,
      subtotal: BigInt(money.subtotal),
      discountTotal: BigInt(money.discountTotal),
      taxTotal: BigInt(money.taxTotal),
      grandTotal: BigInt(money.grandTotal),
    };

    const items: InvoiceItemWriteData[] = parsed.items.map((it, i) => ({
      position: it.position,
      description: it.description,
      hsnSac: it.hsnSac,
      quantity: it.quantity,
      unitPrice: BigInt(it.unitPrice),
      taxRatePercent: it.taxRatePercent,
      taxAmount: BigInt(money.lines[i].taxAmount),
      lineTotal: BigInt(money.lines[i].lineTotal),
    }));

    return { data, items };
  }
}

// Re-exported so the controller can type the status filter without importing Prisma.
export type InvoiceStatusFilter = "Draft" | "Pending" | "Paid";

export const invoiceService = new InvoiceService();
