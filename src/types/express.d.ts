import "express";

// Augment Express' Request type so handlers can read `req.userId`, set by
// authMiddleware (required) or optionalAuth (may stay undefined for anonymous callers).
//
// userId is the ONLY identity in this app. There is deliberately no device id: ownership
// of invoices, customers and company profiles is by userId and nothing else.
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}
