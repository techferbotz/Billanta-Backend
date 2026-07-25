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
//
// `undefined` (an endpoint with no payload — e.g. logout, delete) becomes `{}`. An explicit
// `null` is PRESERVED — e.g. `GET /company` returns `data: null` when no company is set up
// yet. (Using `data ?? {}` here would wrongly coerce that null to `{}`.)
export const sendSuccess = <T>(res: Response, data?: T, status = 200): void => {
  res.status(status).json({ success: true, data: data === undefined ? {} : data });
};
