import { Router } from "express";
import { adminAuth } from "../../common/middleware/adminAuth.middleware";
import { uploadSingleImage } from "../../common/middleware/upload.middleware";
import { asyncHandler } from "../../common/utils/asyncHandler";
import {
  servePanel,
  panelLogin,
  listTemplates,
  createTemplate,
  getTemplate,
  updateTemplate,
  deleteTemplate,
  createVersion,
  getVersion,
  publishVersion,
  uploadMedia,
} from "./controller/admin.controller";

// Template-authoring API + the self-contained admin panel. Mounted at /admin BEFORE the
// user auth middleware — it authenticates with ADMIN_API_KEY, not a user JWT.
const router = Router();

// --- PUBLIC: the panel page and its hardcoded-credential login. MUST be registered before
//     router.use(adminAuth) so they don't require the key (the page holds no secret). ---
router.get("/", servePanel);
router.post("/login", asyncHandler(panelLogin));

// --- everything below requires the admin key ---
router.use(adminAuth);

router.get("/templates", asyncHandler(listTemplates));
router.post("/templates", asyncHandler(createTemplate));
router.get("/templates/:id", asyncHandler(getTemplate));
router.patch("/templates/:id", asyncHandler(updateTemplate));
router.delete("/templates/:id", asyncHandler(deleteTemplate));

router.post("/templates/:id/versions", asyncHandler(createVersion));
router.get("/templates/:id/versions/:v", asyncHandler(getVersion));
router.post("/templates/:id/versions/:v/publish", asyncHandler(publishVersion));

router.post("/media", uploadSingleImage, asyncHandler(uploadMedia));

export default router;
