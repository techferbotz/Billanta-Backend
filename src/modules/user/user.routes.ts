import { Router } from "express";
import { authMiddleware } from "../../common/middleware/auth.middleware";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { getMe, updateMe, deleteMe } from "./controller/user.controller";

// The signed-in user's own profile. Every route requires a valid access token, and each
// one operates on `req.userId` — there is deliberately no `/users/:id`, so one user can
// never address another.
const router = Router();

router.use(authMiddleware);

router.get("/me", asyncHandler(getMe));
router.patch("/me", asyncHandler(updateMe));
router.delete("/me", asyncHandler(deleteMe));

export default router;
