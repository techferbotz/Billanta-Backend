import { Request, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { AppError } from "./AppError";
import { ErrorResponse } from "../response/apiResponse";

// THE central error handler. Must be registered after all routes — Express identifies it
// as an error handler by its four parameters.
//
// Every failure response in the app is produced here, so the shape
// `{ success: false, message, code? }` can never drift between endpoints.
export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const fail = (status: number, message: string): void => {
    const body: ErrorResponse = { success: false, message };
    res.status(status).json(body);
  };

  // Known application errors (validation, auth, ownership, premium gating, ...).
  if (err instanceof AppError) {
    // `code` comes first so it's easy to spot when eyeballing a response.
    const body: ErrorResponse = err.code
      ? { success: false, code: err.code, message: err.message }
      : { success: false, message: err.message };
    res.status(err.statusCode).json(body);
    return;
  }

  // Malformed JSON body, thrown by express.json().
  if (err instanceof SyntaxError && "body" in err) {
    fail(400, "Invalid JSON body");
    return;
  }

  // File-upload errors from multer (file too large, too many files, ...).
  if (err instanceof Error && err.name === "MulterError") {
    fail(400, `Upload error: ${err.message}`);
    return;
  }

  // Prisma errors mapped centrally, so repositories never have to translate them.
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2025 — "record not found" on update/delete.
    if (err.code === "P2025") {
      fail(404, "Resource not found");
      return;
    }
    // P2002 — unique constraint violation (duplicate invoice number, email, ...).
    if (err.code === "P2002") {
      fail(409, "Resource already exists");
      return;
    }
    // P2003 — foreign-key violation. The only FK a client write can hit in this app is
    // `<resource>.userId -> User`: it fires when the authenticated token's account no longer exists
    // (deleted, or a token minted against a since-reset DB — see APP-009). That is an auth problem,
    // not a server bug — a read for the same user simply finds nothing and 200s, while a write trips
    // the constraint. Answer 401 so the client re-authenticates, with a distinct code so it goes
    // straight to a fresh sign-in (its refresh token is gone with the account, so a refresh can't help).
    if (err.code === "P2003") {
      const constraint = typeof err.meta?.constraint === "string" ? err.meta.constraint : "";
      if (constraint.includes("userId")) {
        res.status(401).json({
          success: false,
          code: "ACCOUNT_NOT_FOUND",
          message: "Your account no longer exists. Please sign in again.",
        });
        return;
      }
      // Any other FK means the request itself referenced a non-existent related record.
      fail(400, "Request references a record that does not exist");
      return;
    }
  }

  // Anything else is an unexpected bug: log it server-side (never the request body, which
  // could hold tokens) and return an opaque 500.
  console.error(err);
  fail(500, "Internal server error");
};
