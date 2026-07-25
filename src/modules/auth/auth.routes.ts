import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { googleLogin, refresh, logout } from "./controller/auth.controller";

// Token endpoints. All PUBLIC — they are how a caller obtains credentials in the first
// place, so requiring an access token here would be circular. Each one authenticates by
// its own payload: a Google idToken, or a refresh token.
const router = Router();

router.post("/google", asyncHandler(googleLogin));
router.post("/refresh", asyncHandler(refresh));
router.post("/logout", asyncHandler(logout));

export default router;
