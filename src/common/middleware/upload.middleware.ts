import multer from "multer";
import { BadRequestError } from "../errors/AppError";

// Multipart handling for POST /media. Memory storage (not disk) because the buffer goes
// straight into sharp for compression and then to S3 — it never needs to touch the
// filesystem, which also keeps the container's disk read-only-friendly.
//
// Media in Billanta is logos, signatures and QR images: small. An 8 MB cap is generous for
// those while bounding memory use per request.
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MEDIA_BYTES, files: 1 },
  // Images only — everything media serves is an image, and sharp would reject the rest
  // anyway. Rejecting here gives a clean 400 instead of a compression error later.
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(
        new BadRequestError(
          `Unsupported file type "${file.mimetype}". Only image uploads are allowed.`
        )
      );
    }
  },
});

// The multipart field name is "file".
export const uploadSingleImage = upload.single("file");
