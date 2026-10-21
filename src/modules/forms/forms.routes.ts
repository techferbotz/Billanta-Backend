import { Router } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { getForms } from "./controller/forms.controller";

// Public: the forms are needed offline and before sign-in, and say nothing about any user.
const router = Router();

router.get("/", asyncHandler(getForms));

export default router;
