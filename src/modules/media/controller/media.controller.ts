import { Request, Response } from "express";
import { sendSuccess } from "../../../common/response/apiResponse";
import { getUserId } from "../../../common/utils/getUserId";
import { BadRequestError } from "../../../common/errors/AppError";
import { mediaService } from "../service/media.service";

// POST /media — multipart field "file" -> two WebP sizes in S3 -> { url, thumbnailUrl, contentType }
export const uploadMedia = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);

  // multer put the parsed file on req.file. Absent => the client sent no "file" part.
  const file = req.file;
  if (!file) {
    throw new BadRequestError('Expected a multipart form field named "file".');
  }

  const result = await mediaService.upload(userId, {
    mimeType: file.mimetype,
    buffer: file.buffer,
  });
  sendSuccess(res, result, 201);
};
