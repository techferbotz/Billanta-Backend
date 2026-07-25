import { Request, Response } from "express";
import { sendSuccess } from "../../../common/response/apiResponse";
import { requireObjectBody, requireString } from "../../../common/validation";
import { authService } from "../service/auth.service";

// Thin controllers: read input, validate its shape, call the service, respond.
// No business logic and no Prisma here.

// The device hint stored alongside a refresh token. Truncated because User-Agent is
// client-controlled and we don't want an unbounded string in the database.
const userAgentOf = (req: Request): string | null => req.get("user-agent")?.slice(0, 255) ?? null;

// POST /auth/google — { idToken } -> { accessToken, refreshToken, expiresIn, user }
export const googleLogin = async (req: Request, res: Response): Promise<void> => {
  const body = requireObjectBody(req.body);
  // 4096 chars: a Google idToken is a JWT and comfortably exceeds the default limit.
  const idToken = requireString(body.idToken, "idToken", 4096);

  const result = await authService.loginWithGoogle(idToken, userAgentOf(req));
  sendSuccess(res, result);
};

// POST /auth/refresh — { refreshToken } -> a new rotated pair
export const refresh = async (req: Request, res: Response): Promise<void> => {
  const body = requireObjectBody(req.body);
  const refreshToken = requireString(body.refreshToken, "refreshToken", 512);

  const result = await authService.refresh(refreshToken, userAgentOf(req));
  sendSuccess(res, result);
};

// POST /auth/logout — { refreshToken } -> {}
export const logout = async (req: Request, res: Response): Promise<void> => {
  const body = requireObjectBody(req.body);
  const refreshToken = requireString(body.refreshToken, "refreshToken", 512);

  await authService.logout(refreshToken);
  sendSuccess(res);
};
