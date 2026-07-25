import { Request, Response } from "express";
import { sendSuccess } from "../../../common/response/apiResponse";
import { BadRequestError } from "../../../common/errors/AppError";
import { getUserId } from "../../../common/utils/getUserId";
import { optionalString, requireObjectBody } from "../../../common/validation";
import { userService } from "../service/user.service";
import { UpdateUserProfileData } from "../repository/user.repository";

// GET /users/me
export const getMe = async (req: Request, res: Response): Promise<void> => {
  const user = await userService.getById(getUserId(req));
  sendSuccess(res, user);
};

// PATCH /users/me — { name?, photoUrl? }
//
// Only display fields are editable. email and googleId come from the verified Google
// profile and are not client-writable: letting a client change its own email would break
// the account-linking path in auth.service.
export const updateMe = async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  const body = requireObjectBody(req.body);

  // Build the patch from keys the client actually sent, so an omitted field is left
  // alone while an explicit null clears it.
  const data: UpdateUserProfileData = {};
  const name = optionalString(body.name, "name", 120);
  if (name !== undefined) {
    if (name === null) {
      // A user must always have a display name — it's printed on invoices.
      throw new BadRequestError('"name" cannot be cleared');
    }
    data.name = name;
  }
  const photoUrl = optionalString(body.photoUrl, "photoUrl", 1000);
  if (photoUrl !== undefined) data.photoUrl = photoUrl;

  const user = await userService.updateProfile(userId, data);
  sendSuccess(res, user);
};

// DELETE /users/me — full account + data deletion.
export const deleteMe = async (req: Request, res: Response): Promise<void> => {
  await userService.deleteAccount(getUserId(req));
  sendSuccess(res);
};
