import { Invoice, InvoiceItem, InvoiceStatus, Prisma } from "@prisma/client";
import { prisma } from "../../../prisma/client";
import { serializable } from "../../../prisma/serializable";
import { PageParams, PaginatedResult, paginate } from "../../../common/pagination";
import { ConflictError } from "../../../common/errors/AppError";
import { Values } from "../../../fields/values";

// All Invoice / InvoiceItem database access. No Prisma outside this file.
//
// Every read/write is scoped by userId (ownership boundary; foreign rows 404 in the service).
// Money columns are BigInt paise; the service passes already-recomputed totals, so this layer
// never calculates anything.

export type InvoiceWithItems = Invoice & { items: InvoiceItem[] };

// What one write persists: the values map, the columns the service derived from it, and the
// server-computed totals.
export interface InvoiceWriteData {
  status: InvoiceStatus;
  templateId: string;
  templateVersion: number;
  values: Values;
  invoiceNumber: string | null;
  customerName: string | null;
  customerPhone: string | null;
  themeOverrides: Prisma.InputJsonValue | undefined;
  hiddenSections: Prisma.InputJsonValue | undefined;
  pdfPath?: string | null; // undefined = leave the stored value alone
  updatedAt: Date;
  deletedAt: Date | null;
  subtotal: bigint;
  discountTotal: bigint;
  taxTotal: bigint;
  grandTotal: bigint;
}

export interface InvoiceItemWriteData {
  lineId: string;
  position: number;
  values: Values;
  taxAmount: bigint;
  lineTotal: bigint;
}

// Build the Prisma scalar payload. Absent customisation becomes JSON null, so a re-POST that
// omits it fully clears it rather than leaving a stale value.
const toPrismaData = (data: InvoiceWriteData) => ({
  status: data.status,
  templateId: data.templateId,
  templateVersion: data.templateVersion,
  values: data.values as Prisma.InputJsonObject,
  invoiceNumber: data.invoiceNumber,
  customerName: data.customerName,
  customerPhone: data.customerPhone,
  themeOverrides: data.themeOverrides ?? Prisma.JsonNull,
  hiddenSections: data.hiddenSections ?? Prisma.JsonNull,
  ...(data.pdfPath !== undefined ? { pdfPath: data.pdfPath } : {}),
  updatedAt: data.updatedAt,
  deletedAt: data.deletedAt,
  subtotal: data.subtotal,
  discountTotal: data.discountTotal,
  taxTotal: data.taxTotal,
  grandTotal: data.grandTotal,
});

const toPrismaItems = (items: InvoiceItemWriteData[]) =>
  items.map((it) => ({ ...it, values: it.values as Prisma.InputJsonObject }));

const INCLUDE_ITEMS = { items: { orderBy: { position: "asc" } } } as const;

export class InvoiceRepository {
  async findByIdForUser(id: string, userId: string): Promise<InvoiceWithItems | null> {
    return prisma.invoice.findFirst({ where: { id, userId }, include: INCLUDE_ITEMS });
  }

  /**
   * A page of the user's invoices (excluding soft-deleted), newest-first. `q` matches the
   * invoice number and the customer name/phone (columns derived from `values`); `status` filters
   * by lifecycle.
   */
  async listForUser(
    userId: string,
    page: PageParams,
    filters: { status?: InvoiceStatus; q?: string }
  ): Promise<PaginatedResult<InvoiceWithItems>> {
    const where: Prisma.InvoiceWhereInput = { userId, deletedAt: null };
    if (filters.status) where.status = filters.status;
    if (filters.q) {
      where.OR = [
        { invoiceNumber: { contains: filters.q, mode: "insensitive" } },
        { customerName: { contains: filters.q, mode: "insensitive" } },
        { customerPhone: { contains: filters.q, mode: "insensitive" } },
      ];
    }
    const rows = await prisma.invoice.findMany({
      where,
      include: INCLUDE_ITEMS,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: page.limit + 1,
      ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    });
    return paginate(rows, page.limit);
  }

  /**
   * Create or fully replace the user's own invoice with a client-supplied id. Idempotent by
   * (userId, id): re-POSTing replaces scalars AND lines (old lines are deleted first). A
   * cross-user id collision, or a duplicate invoice number, is a 409 — the foreign row is
   * never touched.
   */
  async upsertOwn(
    userId: string,
    id: string,
    data: InvoiceWriteData,
    items: InvoiceItemWriteData[]
  ): Promise<InvoiceWithItems> {
    return prisma.$transaction(async (tx) => {
      const byId = await tx.invoice.findUnique({ where: { id }, select: { id: true, userId: true } });
      if (byId && byId.userId !== userId) {
        throw new ConflictError("An invoice with this id already exists");
      }
      await this.assertNumberFree(tx, userId, data.invoiceNumber, id);

      if (byId) {
        await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
        return tx.invoice.update({
          where: { id },
          data: { ...toPrismaData(data), items: { create: toPrismaItems(items) } },
          include: INCLUDE_ITEMS,
        });
      }
      return tx.invoice.create({
        data: { id, userId, ...toPrismaData(data), items: { create: toPrismaItems(items) } },
        include: INCLUDE_ITEMS,
      });
    });
  }

  // Server-generated id (client sent none). No idempotency concern.
  async createNew(
    userId: string,
    data: InvoiceWriteData,
    items: InvoiceItemWriteData[]
  ): Promise<InvoiceWithItems> {
    return prisma.$transaction(async (tx) => {
      await this.assertNumberFree(tx, userId, data.invoiceNumber, null);
      return tx.invoice.create({
        data: { userId, ...toPrismaData(data), items: { create: toPrismaItems(items) } },
        include: INCLUDE_ITEMS,
      });
    });
  }

  /**
   * Rewrite the user's own invoice from its current state: `build` (the service's recompute) turns
   * the stored invoice into the full write. Used by PATCH, whose values merge can move totals.
   * Serializable, so a concurrent write can't be lost between the read and the rewrite. Returns
   * null if no such invoice belongs to this user.
   */
  async rewriteOwn(
    userId: string,
    id: string,
    build: (current: InvoiceWithItems) => { data: InvoiceWriteData; items: InvoiceItemWriteData[] }
  ): Promise<InvoiceWithItems | null> {
    return serializable(async (tx) => {
      const current = await tx.invoice.findFirst({ where: { id, userId }, include: INCLUDE_ITEMS });
      if (!current) return null;
      const { data, items } = build(current);
      await this.assertNumberFree(tx, userId, data.invoiceNumber, id);
      await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
      return tx.invoice.update({
        where: { id },
        data: { ...toPrismaData(data), items: { create: toPrismaItems(items) } },
        include: INCLUDE_ITEMS,
      });
    });
  }

  /**
   * Soft-delete the user's own invoice — idempotently. A row owned by this user counts as
   * success whether or not it was already deleted (an offline client retrying a DELETE it
   * already applied must not get a 404). deletedAt/updatedAt are stamped only on the actual
   * null->deleted transition, so a repeat delete does NOT re-bump updatedAt and re-surface the
   * tombstone in every device's next pull. Deleting releases the invoice number. Returns false
   * only for a missing/foreign id (-> 404).
   */
  async softDeleteOwn(userId: string, id: string, when: Date): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findFirst({
        where: { id, userId },
        select: { id: true, deletedAt: true, updatedAt: true },
      });
      if (!existing) return false;
      if (existing.deletedAt === null) {
        // Keep updatedAt MONOTONIC — never below the row's current value — so the tombstone can't
        // sink beneath a sync cursor already handed to another device (which would hide the
        // deletion from it forever). `deletedAt` records the actual delete time.
        const updatedAt = when.getTime() > existing.updatedAt.getTime() ? when : existing.updatedAt;
        await tx.invoice.update({ where: { id }, data: { deletedAt: when, updatedAt, invoiceNumber: null } });
      }
      return true;
    });
  }

  /**
   * One bounded page of the user's changes since `cursor` (a (updatedAt, id) keyset position),
   * including tombstones so deletions propagate. Ordered by (updatedAt, id) — the same total
   * order the cursor advances through — so no same-timestamp rows are ever split across a page
   * boundary. Returns up to `limit + 1` rows; the caller uses the extra to detect hasMore.
   */
  async changedSince(
    userId: string,
    cursor: { updatedAt: Date; id: string } | null,
    limit: number
  ): Promise<InvoiceWithItems[]> {
    const where: Prisma.InvoiceWhereInput = { userId };
    if (cursor) {
      where.OR = [
        { updatedAt: { gt: cursor.updatedAt } },
        { updatedAt: cursor.updatedAt, id: { gt: cursor.id } },
      ];
    }
    return prisma.invoice.findMany({
      where,
      include: INCLUDE_ITEMS,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: limit + 1,
    });
  }

  // For sync LWW: the current stored version's id/updatedAt, or null.
  async findStamp(id: string): Promise<{ userId: string; updatedAt: Date } | null> {
    return prisma.invoice.findUnique({ where: { id }, select: { userId: true, updatedAt: true } });
  }

  // Throw a 409 if `invoiceNumber` is already used by a DIFFERENT live invoice of this user. An
  // empty number (a draft) never clashes; a deleted invoice has already released its number.
  private async assertNumberFree(
    tx: Prisma.TransactionClient,
    userId: string,
    invoiceNumber: string | null,
    exceptId: string | null
  ): Promise<void> {
    if (invoiceNumber === null) return;
    const clash = await tx.invoice.findFirst({
      where: { userId, invoiceNumber, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new ConflictError(`Invoice number "${invoiceNumber}" is already used`);
  }
}

export const invoiceRepository = new InvoiceRepository();
