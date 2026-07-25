import { Router } from "express";
import { authMiddleware } from "../../common/middleware/auth.middleware";
import { asyncHandler } from "../../common/utils/asyncHandler";
import {
  createCustomer,
  listCustomers,
  getCustomer,
  patchCustomer,
  deleteCustomer,
} from "./controller/customer.controller";

// Customer CRUD + search. Auth required; every route is scoped to req.userId inside the
// repository, so one user can never see or touch another's customers.
const router = Router();

router.use(authMiddleware);

router.post("/", asyncHandler(createCustomer));
router.get("/", asyncHandler(listCustomers));
router.get("/:id", asyncHandler(getCustomer));
router.patch("/:id", asyncHandler(patchCustomer));
router.delete("/:id", asyncHandler(deleteCustomer));

export default router;
