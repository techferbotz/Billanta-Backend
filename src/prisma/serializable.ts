import { Prisma } from "@prisma/client";
import { prisma } from "./client";

// Run a read-modify-write at SERIALIZABLE isolation, retrying when Postgres aborts it for a
// conflicting concurrent write (P2034). Used to merge a PATCH into a stored values map: under the
// default READ COMMITTED two concurrent patches could each read the old map and the second write
// would silently drop the first one's keys.
const MAX_ATTEMPTS = 3;

export const serializable = async <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (err) {
      const retryable = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034";
      if (!retryable || attempt >= MAX_ATTEMPTS) throw err;
    }
  }
};
