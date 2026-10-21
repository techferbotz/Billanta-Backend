import { Request, Response } from "express";
import { sendSuccess } from "../../../common/response/apiResponse";
import { getUserId } from "../../../common/utils/getUserId";
import { parsePagination } from "../../../common/pagination";
import { optionalUuid, requireObjectBody } from "../../../common/validation";
import { productService } from "../service/product.service";
import { parseProductPatch, parseProductValues } from "../dto/product.dto";

// POST /products { id?, values } — create (client may supply the uuid `id`; idempotent by that id).
export const createProduct = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const body = requireObjectBody(req.body);
  const id = optionalUuid(body.id, "id");
  const values = parseProductValues(body);
  sendSuccess(res, await productService.create(userId, id, values), 201);
};

// GET /products?q=&limit=&cursor= — the user's products, searchable by name.
export const listProducts = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const page = parsePagination(req);
  const rawQ = req.query.q;
  const q = typeof rawQ === "string" && rawQ.trim().length > 0 ? rawQ.trim() : undefined;
  sendSuccess(res, await productService.list(userId, page, q));
};

// GET /products/:id
export const getProduct = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  sendSuccess(res, await productService.getById(getUserId(req), req.params.id));
};

// PATCH /products/:id { values } — merge into the user's own product.
export const patchProduct = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const patch = parseProductPatch(requireObjectBody(req.body));
  sendSuccess(res, await productService.patch(userId, req.params.id, patch));
};

// DELETE /products/:id — hard delete (no tombstone; products aren't sync-tracked).
export const deleteProduct = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  await productService.delete(getUserId(req), req.params.id);
  sendSuccess(res);
};
