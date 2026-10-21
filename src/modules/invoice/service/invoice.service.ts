import { InvoiceStatus, Prisma } from "@prisma/client";
import {
  invoiceRepository,
  InvoiceWithItems,
  InvoiceItemWriteData,
  InvoiceWriteData,
} from "../repository/invoice.repository";
import { PageParams, PaginatedResult } from "../../../common/pagination";
import { BadRequestError, ConflictError, NotFoundError } from "../../../common/errors/AppError";
import { calculateInvoice } from "../../../common/money";
import { mergeValues, storedValues, Values } from "../../../fields/values";
import {
  InvoiceDto,
  InvoicePatch,
  ParsedInvoiceInput,
  ParsedLine,
  derivedColumnsOf,
  moneyInputsOf,
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

// Everything one write is computed from: a parsed POST body, or a stored invoice with a PATCH
// applied to it.
export interface InvoiceState {
  status: InvoiceStatus;
  templateId: string;
  templateVersion: number;
  values: Values;
  lines: ParsedLine[];
  themeOverrides: Prisma.InputJsonValue | undefined;
  hiddenSections: Prisma.InputJsonValue | undefined;
  pdfPath: string | null | undefined;
  updatedAt: Date;
  deletedAt: Date | null;
}

// A stored JSON column back as write input (JSON null -> absent).
const jsonOrUndefined = (v: Prisma.JsonValue | null): Prisma.InputJsonValue | undefined =>
  v === null ? undefined : (v as Prisma.InputJsonValue);

export class InvoiceService {
  /**
   * Create or replace an invoice. The server ALWAYS recomputes totals from the lines and
   * stores its own values — the client's advisory totals are ignored — and returns them so a
   * client that computed differently can correct itself.
   */
  async upsert(userId: string, parsed: ParsedInvoiceInput): Promise<InvoiceDto> {
    const { data, items } = buildInvoiceWrite(parsed);
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

  /**
   * Apply a PATCH: status, pdfPath and/or a merge into `values`. The invoice is recomputed from
   * its stored lines and the merged values, because a values patch can move the totals (a new
   * discount) or the derived columns (a new number).
   */
  async patch(userId: string, id: string, patch: InvoicePatch): Promise<InvoiceDto> {
    const inv = await invoiceRepository.rewriteOwn(userId, id, (current) =>
      buildInvoiceWrite({
        ...this.stateOf(current),
        status: patch.status ?? current.status,
        values: patch.values ? mergeValues(storedValues(current.values), patch.values) : storedValues(current.values),
        pdfPath: patch.pdfPath,
        updatedAt: patch.updatedAt,
      })
    );
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
      if (stamp && stamp.updatedAt.getTime() >= push.updatedAt.getTime()) {
        continue;
      }
      // build() (recompute) can itself throw a BadRequestError — e.g. the aggregate-overflow
      // guard on a pathological invoice. It MUST be inside the try so one bad invoice becomes a
      // per-item conflict rather than aborting the whole batch (which would permanently wedge the
      // device: it re-pushes the same batch, re-throws, and never drains its other changes).
      try {
        const { data, items } = buildInvoiceWrite(push);
        await invoiceRepository.upsertOwn(userId, id, data, items);
      } catch (err) {
        if (err instanceof ConflictError || err instanceof BadRequestError) {
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

  // A stored invoice as the state a write is computed from.
  private stateOf(inv: InvoiceWithItems): InvoiceState {
    return {
      status: inv.status,
      templateId: inv.templateId,
      templateVersion: inv.templateVersion,
      values: storedValues(inv.values),
      lines: inv.items.map((it) => ({ lineId: it.lineId, values: storedValues(it.values) })),
      themeOverrides: jsonOrUndefined(inv.themeOverrides),
      hiddenSections: jsonOrUndefined(inv.hiddenSections),
      pdfPath: undefined,
      updatedAt: inv.updatedAt,
      deletedAt: inv.deletedAt,
    };
  }

}

/**
 * Recompute totals from the lines and assemble the repository write payload. Pure (no I/O), so the
 * contract-example generator can produce a response exactly as a real write would.
 */
export const buildInvoiceWrite = (
  state: InvoiceState
): { data: InvoiceWriteData; items: InvoiceItemWriteData[] } => {
  const money = moneyInputsOf(state.values, state.lines.map((l) => l.values));
  const totals = calculateInvoice(money.lines, money.discount, {
    discountBeforeTax: money.discountBeforeTax,
  });

  // Guard against aggregate overflow: individual paise are bounded to a safe integer, but a
  // sum across many lines could still exceed it. If it does, refuse rather than store a
  // silently-imprecise BigInt.
  for (const total of [totals.subtotal, totals.discountTotal, totals.taxTotal, totals.grandTotal]) {
    if (total > Number.MAX_SAFE_INTEGER) {
      throw new BadRequestError("Invoice total exceeds the supported maximum");
    }
  }

  const data: InvoiceWriteData = {
    status: state.status,
    templateId: state.templateId,
    templateVersion: state.templateVersion,
    values: state.values,
    ...derivedColumnsOf(state.values, state.deletedAt !== null),
    themeOverrides: state.themeOverrides,
    hiddenSections: state.hiddenSections,
    pdfPath: state.pdfPath,
    updatedAt: state.updatedAt,
    deletedAt: state.deletedAt,
    subtotal: BigInt(totals.subtotal),
    discountTotal: BigInt(totals.discountTotal),
    taxTotal: BigInt(totals.taxTotal),
    grandTotal: BigInt(totals.grandTotal),
  };

  const items: InvoiceItemWriteData[] = state.lines.map((line, i) => ({
    lineId: line.lineId,
    position: i,
    values: line.values,
    taxAmount: BigInt(totals.lines[i].taxAmount),
    lineTotal: BigInt(totals.lines[i].lineTotal),
  }));

  return { data, items };
};

// Re-exported so the controller can type the status filter without importing Prisma.
export type InvoiceStatusFilter = "Draft" | "Pending" | "Paid";

export const invoiceService = new InvoiceService();
