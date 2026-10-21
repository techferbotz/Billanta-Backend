import { Product, Prisma } from "@prisma/client";
import { prisma } from "../../../prisma/client";
import { serializable } from "../../../prisma/serializable";
import { PageParams, PaginatedResult, paginate } from "../../../common/pagination";
import { ConflictError } from "../../../common/errors/AppError";
import { Values, mergeValues, storedValues, stringValue } from "../../../fields/values";

// All Product database access. No Prisma outside this file.
//
// EVERY read and write is scoped by userId — the ownership boundary — structurally, so a caller
// can't forget it. This mirrors CustomerRepository; see that file for the full rationale behind
// the create-or-replace race handling reproduced here.

// The row written for a values map: the map itself plus the name derived from it for search.
const rowData = (values: Values) => ({
  values: values as Prisma.InputJsonObject,
  name: stringValue(values, "description"),
});

export class ProductRepository {
  // A single product, but only if it belongs to this user (findFirst on BOTH id and userId).
  async findByIdForUser(id: string, userId: string): Promise<Product | null> {
    return prisma.product.findFirst({ where: { id, userId } });
  }

  /**
   * A page of the user's products, optionally filtered by `q` (matches the name, case-insensitive).
   * Ordered by name then id — id makes the order total, which cursor pagination requires.
   */
  async listForUser(userId: string, page: PageParams, q?: string): Promise<PaginatedResult<Product>> {
    const where: Prisma.ProductWhereInput = { userId };
    if (q) where.name = { contains: q, mode: "insensitive" };

    const rows = await prisma.product.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: page.limit + 1,
      ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    });
    return paginate(rows, page.limit);
  }

  /**
   * Create a product with a client-supplied id, or fully replace this user's own row of that id
   * (offline re-sync). Idempotent by (userId, id).
   *
   * The scoped updateMany-then-create pattern is security-critical (a bare upsert keys on id
   * alone): user B's POST with user A's id must never fall into an UPDATE and overwrite A's row.
   * We UPDATE only rows matching (id, userId); if none matched we CREATE. A CREATE that hits the
   * id primary key is disambiguated — this user's own racing create converges (re-run the scoped
   * update, return it, no 409); a foreign id is a genuine 409 and its row is never touched.
   */
  async createOrReplaceOwn(userId: string, id: string, values: Values): Promise<Product> {
    const data = rowData(values);
    const updated = await prisma.product.updateMany({ where: { id, userId }, data });
    if (updated.count === 1) {
      return (await prisma.product.findFirst({ where: { id, userId } }))!;
    }
    try {
      return await prisma.product.create({ data: { id, userId, ...data } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const retry = await prisma.product.updateMany({ where: { id, userId }, data });
        if (retry.count === 1) {
          return (await prisma.product.findFirst({ where: { id, userId } }))!;
        }
        throw new ConflictError("A product with this id already exists");
      }
      throw err;
    }
  }

  // Create with a SERVER-generated id (client sent none). No idempotency concern.
  async createNew(userId: string, values: Values): Promise<Product> {
    return prisma.product.create({ data: { userId, ...rowData(values) } });
  }

  /**
   * Merge a patch into the user's own product. Returns the updated row, or null if no row with
   * that id belongs to this user. Serializable, so two concurrent patches can't drop each other's
   * keys.
   */
  async patchOwn(userId: string, id: string, patch: Values): Promise<Product | null> {
    return serializable(async (tx) => {
      const existing = await tx.product.findFirst({ where: { id, userId } });
      if (!existing) return null;
      const merged = mergeValues(storedValues(existing.values), patch);
      return tx.product.update({ where: { id }, data: rowData(merged) });
    });
  }

  // Hard-delete the user's own product. Returns whether a row was removed, so a foreign or missing
  // id yields a clean 404 rather than a false success.
  async deleteOwn(userId: string, id: string): Promise<boolean> {
    const deleted = await prisma.product.deleteMany({ where: { id, userId } });
    return deleted.count > 0;
  }
}

export const productRepository = new ProductRepository();
