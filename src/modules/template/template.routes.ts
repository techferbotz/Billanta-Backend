import { Router } from "express";
import { optionalAuth } from "../../common/middleware/auth.middleware";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { listTemplates, getTemplate, getCompiled } from "./controller/template.controller";

// Public template browsing + download. `optionalAuth` because template listing must work
// logged-out — but a valid token still attaches req.userId so premium templates can be
// unlocked on GET /templates/:id/compiled.
const router = Router();

router.use(optionalAuth);

// Static/specific routes registered before nothing ambiguous here, but keep :id last.
router.get("/", asyncHandler(listTemplates));
router.get("/:id", asyncHandler(getTemplate));
router.get("/:id/compiled", asyncHandler(getCompiled));

export default router;
