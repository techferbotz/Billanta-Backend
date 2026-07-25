// Base class for all expected/operational errors. Carries an HTTP status code (and an
// optional machine-readable `code`) that the central error middleware turns into the
// standard failure envelope.
//
// Throw these — never `res.status(...).json(...)` an error by hand. One code path
// producing every error response is what keeps the envelope consistent.
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;

  constructor(statusCode: number, message: string, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = new.target.name;
    // Restore the prototype chain so `instanceof` still works after transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// 400 — the request failed validation.
export class BadRequestError extends AppError {
  constructor(message = "Bad request", code?: string) {
    super(400, message, code);
  }
}

// 401 — missing/invalid authentication.
export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized", code?: string) {
    super(401, message, code);
  }
}

// 403 — authenticated, but not allowed (e.g. a free user requesting a premium template).
export class ForbiddenError extends AppError {
  constructor(message = "Forbidden", code?: string) {
    super(403, message, code);
  }
}

// 404 — the resource does not exist, OR it belongs to another user.
//
// Returning 404 rather than 403 for someone else's row is deliberate: a 403 would
// confirm that the id exists, leaking the existence of other users' invoices and
// customers. Ownership checks always land here.
export class NotFoundError extends AppError {
  constructor(message = "Not found", code?: string) {
    super(404, message, code);
  }
}

// 409 — the request conflicts with existing state (duplicate invoice number, publishing
// an already-published version, ...). Prisma's P2002 unique-constraint violation is
// mapped to this status centrally in errorHandler.
export class ConflictError extends AppError {
  constructor(message = "Conflict", code?: string) {
    super(409, message, code);
  }
}

// 503 — a feature is not configured or is temporarily unavailable (e.g. media uploads
// when S3 isn't set up). Distinct from a 500 bug and from a 400 client error: it tells
// the client "this endpoint is off right now", not "you did something wrong".
export class ServiceUnavailableError extends AppError {
  constructor(message = "Service unavailable", code?: string) {
    super(503, message, code);
  }
}
