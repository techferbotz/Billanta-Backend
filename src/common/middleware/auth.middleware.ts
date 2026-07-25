import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt";
import { UnauthorizedError } from "../errors/AppError";

// Pull "Authorization: Bearer <token>" out of a request, or null.
const bearerToken = (req: Request): string | null => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
};

// REQUIRED auth. Rejects with 401 unless a valid access token is present, then attaches
// the authenticated user id to req.userId. Everything that touches user-owned data
// (invoices, customers, company, settings, media) sits behind this.
export const authMiddleware = (req: Request, _res: Response, next: NextFunction): void => {
  const token = bearerToken(req);
  if (!token) {
    throw new UnauthorizedError("Missing or invalid Authorization header");
  }

  try {
    req.userId = verifyAccessToken(token).userId;
  } catch {
    throw new UnauthorizedError("Invalid or expired access token");
  }

  next();
};

// OPTIONAL auth, for endpoints that must work logged-OUT — chiefly template browsing and
// downloading, which an anonymous user needs before they ever consider signing in.
//
// A valid token sets req.userId; a missing OR invalid one simply continues anonymously
// rather than rejecting. Handlers therefore must treat req.userId as possibly undefined
// (see getUserId, and the premium check in the template module).
export const optionalAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const token = bearerToken(req);

  if (token) {
    try {
      req.userId = verifyAccessToken(token).userId;
    } catch {
      // Ignore a bad token here — proceed as anonymous. Failing closed would break
      // template browsing for a signed-out user whose access token merely expired.
    }
  }

  next();
};
