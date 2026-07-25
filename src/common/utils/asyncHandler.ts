import { Request, Response, NextFunction, RequestHandler } from "express";
import { ParamsDictionary } from "express-serve-static-core";

// Wraps an async route handler so a rejected promise is forwarded to the central error
// middleware instead of becoming an unhandled rejection. This is what lets controllers
// simply `throw new NotFoundError(...)` with no try/catch anywhere.
//
// Generic over the route params (P) so handlers that type their params
// (e.g. Request<{ id: string }>) keep that type through the wrapper.
export const asyncHandler =
  <P = ParamsDictionary>(
    fn: (req: Request<P>, res: Response, next: NextFunction) => Promise<unknown>
  ): RequestHandler<P> =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
