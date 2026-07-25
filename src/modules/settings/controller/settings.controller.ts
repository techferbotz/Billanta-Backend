import { Request, Response } from "express";
import { sendSuccess } from "../../../common/response/apiResponse";
import { getUserId } from "../../../common/utils/getUserId";
import { requireObjectBody } from "../../../common/validation";
import { settingsService } from "../service/settings.service";
import { parseSettingsBody } from "../dto/settings.dto";

// GET /settings -> the user's settings (auto-created with defaults on first call).
export const getSettings = async (req: Request, res: Response): Promise<void> => {
  const settings = await settingsService.getOrCreate(getUserId(req));
  sendSuccess(res, settings);
};

// PUT /settings -> merge the sent fields into the user's settings (see settings.dto.ts for
// why Settings is a merge while Company is a full-replace).
export const putSettings = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const data = parseSettingsBody(requireObjectBody(req.body));
  const settings = await settingsService.put(userId, data);
  sendSuccess(res, settings);
};
