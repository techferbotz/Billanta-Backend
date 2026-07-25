import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { config } from "../../config/env";
import { UnauthorizedError } from "../errors/AppError";

// Auth for the template-authoring API (`/admin/*`). Gated by the strong shared secret
// ADMIN_API_KEY, SEPARATE from the user JWT/refresh flow — the operator (or the admin panel
// after its own login) is a server-side caller, not a device or a user.
//
// Constant-time comparison so a wrong key can't be discovered by timing. Both sides are
// hashed first so the compare never leaks the key's length either. Accepts
// `Authorization: Bearer <key>` or the bare key.
const keyMatches = (header: string | undefined): boolean => {
  if (!header) return false;
  const prefix = "Bearer ";
  const provided = header.startsWith(prefix) ? header.slice(prefix.length) : header;
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(config.adminApiKey).digest();
  return crypto.timingSafeEqual(a, b);
};

export const adminAuth = (req: Request, _res: Response, next: NextFunction): void => {
  if (!keyMatches(req.header("authorization"))) {
    throw new UnauthorizedError("Invalid admin credentials");
  }
  next();
};
