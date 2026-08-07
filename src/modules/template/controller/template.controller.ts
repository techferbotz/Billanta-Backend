import { Request, Response } from "express";
import { sendSuccess } from "../../../common/response/apiResponse";
import { BadRequestError } from "../../../common/errors/AppError";
import { getOptionalUserId } from "../../../common/utils/getUserId";
import { parsePagination } from "../../../common/pagination";
import { templateService } from "../service/template.service";

// GET /templates?limit=&cursor= — the picker list (works logged-out), cursor-paginated.
export const listTemplates = async (req: Request, res: Response): Promise<void> => {
  const page = parsePagination(req);
  sendSuccess(res, await templateService.list(page));
};

// GET /templates/:id
export const getTemplate = async (
  req: Request<{ id: string }>,
  res: Response
): Promise<void> => {
  sendSuccess(res, await templateService.getById(req.params.id));
};

// GET /templates/:id/compiled?version= — the compiled Billanta Template JSON ("download").
//
// Supports conditional requests: the version's checksum is the ETag, so a client holding the
// current tree revalidates with If-None-Match and gets a 304. A specific ?version= is
// immutable and cached forever; the default (current) response is revalidated on each use,
// because publishing a new version changes what "current" resolves to.
export const getCompiled = async (
  req: Request<{ id: string }>,
  res: Response
): Promise<void> => {
  const userId = getOptionalUserId(req);

  let requestedVersion: number | undefined;
  const raw = req.query.version;
  if (typeof raw === "string" && raw.length > 0) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) {
      throw new BadRequestError('"version" must be a positive integer');
    }
    requestedVersion = n;
  }

  const result = await templateService.getCompiled(req.params.id, requestedVersion, userId);

  const etag = `"${result.checksum}"`;
  if (req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return;
  }
  res.setHeader("ETag", etag);
  // Premium responses are authenticated and MUST NOT be shared-cacheable — `private` keeps a
  // CDN/proxy from serving the paid tree to anonymous callers. Free templates may be `public`.
  // Either way a specific ?version= is immutable; the current view revalidates (no-cache),
  // because publishing a new version changes what "current" resolves to.
  const scope = result.isPremium ? "private" : "public";
  res.setHeader(
    "Cache-Control",
    result.immutable ? `${scope}, max-age=31536000, immutable` : `${scope}, no-cache`
  );
  sendSuccess(res, result.compiled);
};
