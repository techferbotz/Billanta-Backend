import { Router } from "express";
import { authMiddleware } from "../../common/middleware/auth.middleware";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { getSettings, putSettings } from "./controller/settings.controller";

// Per-user invoice defaults. Auth required; scoped to req.userId.
const router = Router();

router.use(authMiddleware);

router.get("/", asyncHandler(getSettings));
router.put("/", asyncHandler(putSettings));

export default router;
