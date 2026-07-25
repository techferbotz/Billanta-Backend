import { Request, Response } from "express";
import { sendSuccess } from "../../../common/response/apiResponse";
import { getUserId } from "../../../common/utils/getUserId";
import { requireObjectBody } from "../../../common/validation";
import { companyService } from "../service/company.service";
import { parseCompanyBody } from "../dto/company.dto";

// GET /company -> the company, or `data: null` when not yet set up.
export const getCompany = async (req: Request, res: Response): Promise<void> => {
  const company = await companyService.get(getUserId(req));
  sendSuccess(res, company);
};

// PUT /company -> create or fully replace the seller profile.
export const putCompany = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const data = parseCompanyBody(requireObjectBody(req.body));
  const company = await companyService.put(userId, data);
  sendSuccess(res, company);
};
