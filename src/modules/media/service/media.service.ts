import { randomUUID } from "node:crypto";
import { s3Storage } from "../../../storage/s3Storage";
import {
  compressImage,
  compressThumbnail,
  COMPRESSED_IMAGE_MIME,
  COMPRESSED_IMAGE_EXT,
} from "../../../storage/imageCompressor";
import { BadRequestError, ServiceUnavailableError } from "../../../common/errors/AppError";

export interface UploadedImage {
  mimeType: string;
  buffer: Buffer;
}

export interface MediaResult {
  url: string; // full-size WebP (≤1280px)
  thumbnailUrl: string; // thumbnail WebP (≤512px)
  contentType: string; // always image/webp
}

export class MediaService {
  /**
   * Compress an uploaded image to two WebP sizes and store both in S3.
   *
   * Uploads are namespaced per user (`media/<userId>/…`) so one user's objects are grouped
   * — useful for the account-deletion cleanup that a later phase can hang off this prefix.
   * The full and thumbnail derivatives share one uuid, so the pair is obvious in the bucket.
   *
   * When storage isn't configured this is a clean 503, NOT a crash: media is an optional
   * cloud feature, and every other endpoint must keep working without S3.
   */
  async upload(userId: string, file: UploadedImage): Promise<MediaResult> {
    if (!s3Storage.enabled) {
      throw new ServiceUnavailableError(
        "Media storage is not configured. Set S3_BUCKET and AWS_REGION on the server."
      );
    }

    let full: Buffer;
    let thumb: Buffer;
    try {
      // Both derived from the ORIGINAL for best quality at each size.
      [full, thumb] = await Promise.all([
        compressImage(file.buffer),
        compressThumbnail(file.buffer),
      ]);
    } catch {
      throw new BadRequestError("Could not process the image (is it a valid image file?).");
    }

    const id = randomUUID();
    const [url, thumbnailUrl] = await Promise.all([
      s3Storage.upload(full, COMPRESSED_IMAGE_MIME, `media/${userId}/${id}.${COMPRESSED_IMAGE_EXT}`),
      s3Storage.upload(
        thumb,
        COMPRESSED_IMAGE_MIME,
        `media/${userId}/${id}_thumb.${COMPRESSED_IMAGE_EXT}`
      ),
    ]);

    if (!url || !thumbnailUrl) {
      // enabled was true, so a null here means the upload itself returned nothing.
      throw new ServiceUnavailableError("Upload failed: media storage returned no URL.");
    }

    return { url, thumbnailUrl, contentType: COMPRESSED_IMAGE_MIME };
  }
}

export const mediaService = new MediaService();
