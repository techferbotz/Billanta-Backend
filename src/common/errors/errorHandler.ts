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
  }

  // Anything else is an unexpected bug: log it server-side (never the request body, which
  // could hold tokens) and return an opaque 500.
  console.error(err);
  fail(500, "Internal server error");
};
