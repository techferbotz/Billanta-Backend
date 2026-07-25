import { Router } from "express";
import { authMiddleware } from "../../common/middleware/auth.middleware";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { getCompany, putCompany } from "./controller/company.controller";

// The seller's own business profile. Auth required; every route is scoped to req.userId,
// so there is no way to address another user's company.
const router = Router();

router.use(authMiddleware);

router.get("/", asyncHandler(getCompany));
router.put("/", asyncHandler(putCompany));

export default router;
