import { PrismaClient } from "@prisma/client";

// Reusable singleton Prisma client — the ONE connection pool for the process.
// In development ts-node-dev reloads modules frequently; caching the client on
// `globalThis` avoids opening a new pool on every reload and exhausting Postgres.
declare global {
  var prismaClient: PrismaClient | undefined;
}

export const prisma = global.prismaClient ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.prismaClient = prisma;
}
