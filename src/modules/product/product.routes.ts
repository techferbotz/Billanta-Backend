import { Router } from "express";
import { authMiddleware } from "../../common/middleware/auth.middleware";
import { asyncHandler } from "../../common/utils/asyncHandler";
import {
  createProduct,
  listProducts,
  getProduct,
  patchProduct,
  deleteProduct,
} from "./controller/product.controller";

// Product CRUD + search. Auth required; every route is scoped to req.userId inside the repository,
// so one user can never see or touch another's products. Same shape as /customers.
const router = Router();

router.use(authMiddleware);

router.post("/", asyncHandler(createProduct));
router.get("/", asyncHandler(listProducts));
router.get("/:id", asyncHandler(getProduct));
router.patch("/:id", asyncHandler(patchProduct));
router.delete("/:id", asyncHandler(deleteProduct));

export default router;
