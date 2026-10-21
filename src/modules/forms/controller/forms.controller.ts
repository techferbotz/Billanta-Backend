import { Request, Response } from "express";
import { sendSuccess } from "../../../common/response/apiResponse";
import { formsService } from "../service/forms.service";

// GET /forms — the app builds its business profile, customer, product and settings screens from
// this. The checksum is the ETag, so a client holding the current document revalidates with
// If-None-Match and gets a 304. It only changes on a deploy, so it revalidates on each use rather
// than being cached blind.
export const getForms = async (req: Request, res: Response): Promise<void> => {
  const { document, checksum } = formsService.get();
  const etag = `"${checksum}"`;
  if (req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return;
  }
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "public, no-cache");
  sendSuccess(res, document);
};
