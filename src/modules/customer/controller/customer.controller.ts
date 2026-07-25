import { Request, Response } from "express";
import { sendSuccess } from "../../../common/response/apiResponse";
import { getUserId } from "../../../common/utils/getUserId";
import { parsePagination } from "../../../common/pagination";
import { optionalUuid, requireObjectBody } from "../../../common/validation";
import { customerService } from "../service/customer.service";
import { parseCreateCustomerBody, parsePatchCustomerBody } from "../dto/customer.dto";

// POST /customers — create (client may supply the uuid `id`; idempotent by that id).
export const createCustomer = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const body = requireObjectBody(req.body);
  const id = optionalUuid(body.id, "id");
  const data = parseCreateCustomerBody(body);
  const customer = await customerService.create(userId, id, data);
  // 201 for a fresh resource; the client already knows the id it sent, so this is mostly
  // cosmetic, but it keeps POST honest.
  sendSuccess(res, customer, 201);
};

// GET /customers?q=&limit=&cursor= — the user's customers, searchable by name/phone.
export const listCustomers = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const page = parsePagination(req);
  const rawQ = req.query.q;
  const q = typeof rawQ === "string" && rawQ.trim().length > 0 ? rawQ.trim() : undefined;
  const result = await customerService.list(userId, page, q);
  sendSuccess(res, result);
};

// GET /customers/:id
export const getCustomer = async (
  req: Request<{ id: string }>,
  res: Response
): Promise<void> => {
  const customer = await customerService.getById(getUserId(req), req.params.id);
  sendSuccess(res, customer);
};

// PATCH /customers/:id — partial update of the user's own customer.
export const patchCustomer = async (
  req: Request<{ id: string }>,
  res: Response
): Promise<void> => {
  const userId = getUserId(req);
  const data = parsePatchCustomerBody(requireObjectBody(req.body));
  const customer = await customerService.patch(userId, req.params.id, data);
  sendSuccess(res, customer);
};

// DELETE /customers/:id
export const deleteCustomer = async (
  req: Request<{ id: string }>,
  res: Response
): Promise<void> => {
  await customerService.delete(getUserId(req), req.params.id);
  sendSuccess(res);
};
