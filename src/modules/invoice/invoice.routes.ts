import { Router } from "express";
import { authMiddleware } from "../../common/middleware/auth.middleware";
import { asyncHandler } from "../../common/utils/asyncHandler";
import {
  createInvoice,
  listInvoices,
  getInvoice,
  patchInvoice,
  deleteInvoice,
  syncInvoices,
} from "./controller/invoice.controller";

// Invoice CRUD + batch sync. Auth required; every route is scoped to req.userId in the
// repository, so one user can never see or touch another's invoices.
const router = Router();

router.use(authMiddleware);

// Static route BEFORE "/:id" so "sync" is never captured as an invoice id.
router.post("/sync", asyncHandler(syncInvoices));

router.post("/", asyncHandler(createInvoice));
router.get("/", asyncHandler(listInvoices));
router.get("/:id", asyncHandler(getInvoice));
router.patch("/:id", asyncHandler(patchInvoice));
router.delete("/:id", asyncHandler(deleteInvoice));

export default router;
