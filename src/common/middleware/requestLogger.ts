import { Request, Response, NextFunction } from "express";

// Logs one line per request: method, URL, status code and response time.
// Intentionally does NOT log headers or bodies, so Google idTokens, refresh tokens and
// the admin API key are never written to the logs.
export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(1)}ms`);
  });

  next();
};
