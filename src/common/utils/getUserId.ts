import { Request } from "express";
import { UnauthorizedError } from "../errors/AppError";

// Read the authenticated user id, or throw 401.
//
// Behind `authMiddleware` this always succeeds — it exists so controllers get a
// `string` instead of `string | undefined` without sprinkling non-null assertions, and
// so a route accidentally mounted without auth fails closed with a 401 rather than
// querying with `userId: undefined` (which in Prisma would match the FIRST row rather
// than none — a data leak).
export const getUserId = (req: Request): string => {
  if (!req.userId) {
    throw new UnauthorizedError("Authentication required");
  }
  return req.userId;
};

// Read the user id when auth is OPTIONAL (behind `optionalAuth`). Returns null for an
// anonymous caller instead of throwing.
export const getOptionalUserId = (req: Request): string | null => req.userId ?? null;
