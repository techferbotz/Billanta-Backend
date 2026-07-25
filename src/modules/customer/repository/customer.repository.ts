import { Customer, Prisma } from "@prisma/client";
import { prisma } from "../../../prisma/client";
import { PageParams, PaginatedResult, paginate } from "../../../common/pagination";
import { ConflictError } from "../../../common/errors/AppError";
import { CustomerWriteData, CustomerPatchData } from "../dto/customer.dto";

// All Customer database access. No Prisma outside this file.
//
// EVERY read and write is scoped by userId. This is the ownership boundary: a client
// supplying another user's customer id must never read, edit or delete it. The methods
// here are built so that "scoped by userId" is structural, not something a caller has to
// remember to add.
export class CustomerRepository {
  // A single customer, but only if it belongs to this user. findFirst with BOTH id and
  // userId — never findUnique by id alone, which would return another user's row.
  async findByIdForUser(id: string, userId: string): Promise<Customer | null> {
    return prisma.customer.findFirst({ where: { id, userId } });
  }

  /**
   * A page of the user's customers, optionally filtered by a search term.
   *
   * `q` matches name OR phone, case-insensitively. Ordering is alphabetical by name with id
   * as the tiebreaker — id makes the order total, which cursor pagination requires to be
   * stable across pages (two customers named "Acme" must always sort the same way).
   */
  async listForUser(
    userId: string,
    page: PageParams,
    q?: string
  ): Promise<PaginatedResult<Customer>> {
    const where: Prisma.CustomerWhereInput = { userId };
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
      ];
    }

    const rows = await prisma.customer.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: page.limit + 1, // one extra row tells paginate() whether another page exists
      ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    });

    return paginate(rows, page.limit);
  }

  /**
   * Create a customer with a client-supplied id, or fully replace it if this user already
   * has one with that id (offline re-sync). Idempotent by (userId, id).
   *
   * The two-step is deliberate and security-critical: `upsert` in Prisma keys on the unique
   * `id` alone, which would let user B's POST with user A's id fall into the UPDATE branch
   * and silently overwrite A's customer. Instead we UPDATE only rows matching (id, userId);
   * if none matched we CREATE.
   *
   * A CREATE can still hit the id primary key (P2002) two ways, and they must be told apart:
   *   - the id belongs to ANOTHER user  -> a genuine conflict, thrown as ConflictError (409);
   *     the foreign row is never touched and never read.
   *   - two of THIS user's own requests raced (offline-sync retry / double-tap): both saw no
   *     row, both tried to create. The loser must NOT 409 — that would break idempotency.
   *     We re-run the scoped UPDATE, which now matches the row the winner created, and return
   *     it. That makes concurrent same-id POSTs converge instead of erroring.
   *
   * Throwing the domain ConflictError HERE (not a Prisma error in the service) keeps
   * @prisma/client out of the service layer.
   */
  async createOrReplaceOwn(
    userId: string,
    id: string,
    data: CustomerWriteData
  ): Promise<Customer> {
    const updated = await prisma.customer.updateMany({ where: { id, userId }, data });
    if (updated.count === 1) {
      // Re-read to return the full row (updateMany returns only a count).
      return (await prisma.customer.findFirst({ where: { id, userId } }))!;
    }

    try {
      return await prisma.customer.create({ data: { id, userId, ...data } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        // The id now exists. If it's this user's own row (a concurrent create won the race),
        // re-apply the scoped update and return it — idempotent, no 409.
        const retry = await prisma.customer.updateMany({ where: { id, userId }, data });
        if (retry.count === 1) {
          return (await prisma.customer.findFirst({ where: { id, userId } }))!;
        }
        // Still not ours -> the id belongs to another user.
        throw new ConflictError("A customer with this id already exists");
      }
      throw err;
    }
  }

  // Create with a SERVER-generated id (client sent no id). No idempotency concern — the id
  // is fresh — so a plain create.
  async createNew(userId: string, data: CustomerWriteData): Promise<Customer> {
    return prisma.customer.create({ data: { userId, ...data } });
  }

  /**
   * Patch the user's own customer. Returns the updated row, or null if no row with that id
   * belongs to this user (so the service can 404 without a separate existence check —
   * `updateMany` touching zero rows IS the ownership check).
   */
  async patchOwn(
    userId: string,
    id: string,
    data: CustomerPatchData
  ): Promise<Customer | null> {
    const updated = await prisma.customer.updateMany({ where: { id, userId }, data });
    if (updated.count === 0) return null;
    return prisma.customer.findFirst({ where: { id, userId } });
  }

  // Delete the user's own customer. Returns whether a row was actually removed, so a
  // foreign or missing id yields a clean 404 rather than a false success.
  async deleteOwn(userId: string, id: string): Promise<boolean> {
    const deleted = await prisma.customer.deleteMany({ where: { id, userId } });
    return deleted.count > 0;
  }
}

export const customerRepository = new CustomerRepository();
