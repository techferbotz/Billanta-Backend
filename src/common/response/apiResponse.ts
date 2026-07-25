import { Response } from "express";

// The standard API envelopes, used by EVERY endpoint except the plain-text health check
// and the public HTML pages (legal, admin panel).
export interface SuccessResponse<T> {
  success: true;
  data: T;
}

export interface ErrorResponse {
  success: false;
  message: string;
  // Optional machine-readable code (e.g. PREMIUM_REQUIRED, TEMPLATE_COMPILE_FAILED) so
  // clients can branch on the failure without string-matching the message.
  code?: string;
}

// Send a standard success response: { success: true, data: ... }.
// `data` defaults to {} for endpoints with no payload (e.g. logout, delete).
export const sendSuccess = <T>(res: Response, data?: T, status = 200): void => {
  res.status(status).json({ success: true, data: data ?? {} });
};
