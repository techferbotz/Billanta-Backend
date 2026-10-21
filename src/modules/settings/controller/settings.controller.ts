import { Request, Response } from "express";
import { sendSuccess } from "../../../common/response/apiResponse";
import { getUserId } from "../../../common/utils/getUserId";
import { requireObjectBody } from "../../../common/validation";
import { settingsService } from "../service/settings.service";
import { parseSettingsPatch, parseSettingsPut } from "../dto/settings.dto";

// GET /settings -> the user's settings (auto-created with defaults on first call).
export const getSettings = async (req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await settingsService.getOrCreate(getUserId(req)));
};

// PUT /settings { values } -> replace the whole map.
export const putSettings = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const values = parseSettingsPut(requireObjectBody(req.body));
  sendSuccess(res, await settingsService.put(userId, values));
};

// PATCH /settings { values } -> merge into the map.
export const patchSettings = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const patch = parseSettingsPatch(requireObjectBody(req.body));
  sendSuccess(res, await settingsService.patch(userId, patch));
};
