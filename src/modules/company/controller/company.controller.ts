import { Request, Response } from "express";
import { sendSuccess } from "../../../common/response/apiResponse";
import { getUserId } from "../../../common/utils/getUserId";
import { requireObjectBody } from "../../../common/validation";
import { companyService } from "../service/company.service";
import { parseCompanyPatch, parseCompanyPut } from "../dto/company.dto";

// GET /company -> the company, or `data: null` when not yet set up.
export const getCompany = async (req: Request, res: Response): Promise<void> => {
  const company = await companyService.get(getUserId(req));
  sendSuccess(res, company);
};

// PUT /company { values } -> create or fully replace the seller profile.
export const putCompany = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const values = parseCompanyPut(requireObjectBody(req.body));
  sendSuccess(res, await companyService.put(userId, values));
};

// PATCH /company { values } -> merge into the profile (creating it if needed).
export const patchCompany = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const patch = parseCompanyPatch(requireObjectBody(req.body));
  sendSuccess(res, await companyService.patch(userId, patch));
};
