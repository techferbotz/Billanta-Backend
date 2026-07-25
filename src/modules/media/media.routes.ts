import { Router } from "express";
import { authMiddleware } from "../../common/middleware/auth.middleware";
import { uploadSingleImage } from "../../common/middleware/upload.middleware";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { uploadMedia } from "./controller/media.controller";

// Media uploads (logos, signatures, QR images). Auth required. The multer middleware runs
// before the handler to parse the multipart body into req.file.
const router = Router();

router.use(authMiddleware);

router.post("/", uploadSingleImage, asyncHandler(uploadMedia));

export default router;
