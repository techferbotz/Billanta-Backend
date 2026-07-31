import { Invoice, InvoiceItem, InvoiceStatus, Prisma } from "@prisma/client";
import { prisma } from "../../../prisma/client";
import { PageParams, PaginatedResult, paginate } from "../../../common/pagination";
import { ConflictError } from "../../../common/errors/AppError";

// All Invoice / InvoiceItem database access. No Prisma outside this file.
//
// Every read/write is scoped by userId (ownership boundary; foreign rows 404 in the service).
// Money columns are BigInt paise; the service passes already-recomputed totals, so this layer
// never calculates anything.

export type InvoiceWithItems = Invoice & { items: InvoiceItem[] };

// The scalar fields + server-computed totals to persist. Snapshots may be undefined (absent);
// we coerce those to JSON null so a re-POST fully replaces rather than leaving a stale snapshot.
export interface InvoiceWriteData {
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
  discountType: Prisma.InvoiceCreateInput["discountType"];
  discountValue: string | null;
  discountBeforeTax: boolean;
  updatedAt: Date;
  deletedAt: Date | null;
  subtotal: bigint;
  discountTotal: bigint;
  taxTotal: bigint;
  grandTotal: bigint;
}

export interface InvoiceItemWriteData {
  position: number;
  description: string;
  hsnSac: string | null;
  quantity: string;
  unitPrice: bigint;
  taxRatePercent: string;
  taxAmount: bigint;
  lineTotal: bigint;
}

// Build the Prisma scalar payload, coercing absent snapshots to explicit JSON null.
const toPrismaData = (data: InvoiceWriteData) => ({
  customerId: data.customerId,
  customerSnapshot: data.customerSnapshot ?? Prisma.JsonNull,
  companySnapshot: data.companySnapshot ?? Prisma.JsonNull,
  invoiceNumber: data.invoiceNumber,
  invoiceDate: data.invoiceDate,
  dueDate: data.dueDate,
  currency: data.currency,
  status: data.status,
  templateId: data.templateId,
  templateVersion: data.templateVersion,
  notes: data.notes,
  discountType: data.discountType,
  discountValue: data.discountValue,
  discountBeforeTax: data.discountBeforeTax,
  updatedAt: data.updatedAt,
  deletedAt: data.deletedAt,
  subtotal: data.subtotal,
  discountTotal: data.discountTotal,
  taxTotal: data.taxTotal,
  grandTotal: data.grandTotal,
});

const INCLUDE_ITEMS = { items: true } as const;

export class InvoiceRepository {
  async findByIdForUser(id: string, userId: string): Promise<InvoiceWithItems | null> {
    return prisma.invoice.findFirst({ where: { id, userId }, include: INCLUDE_ITEMS });
  }

  /**
   * A page of the user's invoices (excluding soft-deleted), newest-first. `q` matches the
   * invoice number and the snapshotted customer name/phone; `status` filters by lifecycle.
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
        { customerSnapshot: { path: ["name"], string_contains: filters.q } },
        { customerSnapshot: { path: ["phone"], string_contains: filters.q } },
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
   * (userId, id): re-POSTing replaces scalars AND items (old items are deleted first). A
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
          data: { ...toPrismaData(data), items: { create: items } },
          include: INCLUDE_ITEMS,
        });
      }
      return tx.invoice.create({
        data: { id, userId, ...toPrismaData(data), items: { create: items } },
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
        data: { userId, ...toPrismaData(data), items: { create: items } },
        include: INCLUDE_ITEMS,
      });
    });
  }

  /**
   * Partial scalar update of the user's own invoice (status/notes/dueDate/pdfPath/…). Does NOT
   * touch items or totals — changing those goes through the full upsert. Returns null if no
   * such invoice belongs to this user.
   */
  async patchOwn(
    userId: string,
    id: string,
    patch: Prisma.InvoiceUpdateInput,
    newInvoiceNumber?: string
  ): Promise<InvoiceWithItems | null> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findFirst({ where: { id, userId }, select: { id: true } });
      if (!existing) return null;
      if (newInvoiceNumber !== undefined) {
        await this.assertNumberFree(tx, userId, newInvoiceNumber, id);
      }
      return tx.invoice.update({ where: { id }, data: patch, include: INCLUDE_ITEMS });
    });
  }

  /**
   * Soft-delete the user's own invoice — idempotently. A row owned by this user counts as
   * success whether or not it was already deleted (an offline client retrying a DELETE it
   * already applied must not get a 404). deletedAt/updatedAt are stamped only on the actual
   * null->deleted transition, so a repeat delete does NOT re-bump updatedAt and re-surface the
   * tombstone in every device's next pull. Returns false only for a missing/foreign id (-> 404).
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
        await tx.invoice.update({ where: { id }, data: { deletedAt: when, updatedAt } });
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

  // Throw a 409 if `invoiceNumber` is already used by a DIFFERENT invoice of this user.
  private async assertNumberFree(
    tx: Prisma.TransactionClient,
    userId: string,
    invoiceNumber: string,
    exceptId: string | null
  ): Promise<void> {
    const clash = await tx.invoice.findFirst({
      where: { userId, invoiceNumber, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new ConflictError(`Invoice number "${invoiceNumber}" is already used`);
  }
}

export const invoiceRepository = new InvoiceRepository();
