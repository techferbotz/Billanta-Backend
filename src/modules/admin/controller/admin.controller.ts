import { Request, Response } from "express";
import { sendSuccess } from "../../../common/response/apiResponse";
import { BadRequestError } from "../../../common/errors/AppError";
import { requireObjectBody, requireString } from "../../../common/validation";
import { adminTemplateService } from "../service/adminTemplate.service";
import { ADMIN_PANEL_HTML } from "../panel/adminPanel";
import {
  parseCreateTemplate,
  parseCreateVersion,
  parseUpdateTemplate,
} from "../dto/admin.dto";

// Parse a positive-integer version from the :v path param.
const versionParam = (raw: string): number => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new BadRequestError('version must be a positive integer');
  return n;
};

// --- PUBLIC (no ADMIN_API_KEY) ------------------------------------------------------

// GET /admin — the self-contained panel page. Contains NO secret.
export const servePanel = (_req: Request, res: Response): void => {
  res.type("html").send(ADMIN_PANEL_HTML);
};

// POST /admin/login — hardcoded creds checked server-side; returns ADMIN_API_KEY on success.
export const panelLogin = async (req: Request, res: Response): Promise<void> => {
  const body = requireObjectBody(req.body);
  const username = requireString(body.username, "username", 120);
  const password = requireString(body.password, "password", 200);
  sendSuccess(res, adminTemplateService.login(username, password));
};

// --- behind ADMIN_API_KEY -----------------------------------------------------------

export const listTemplates = async (_req: Request, res: Response): Promise<void> => {
  sendSuccess(res, { items: await adminTemplateService.listTemplates() });
};

export const createTemplate = async (req: Request, res: Response): Promise<void> => {
  const input = parseCreateTemplate(requireObjectBody(req.body));
  sendSuccess(res, await adminTemplateService.createTemplate(input), 201);
};

export const getTemplate = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  sendSuccess(res, await adminTemplateService.getTemplate(req.params.id));
};

export const updateTemplate = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const input = parseUpdateTemplate(requireObjectBody(req.body));
  sendSuccess(res, await adminTemplateService.updateTemplate(req.params.id, input));
};

export const deleteTemplate = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  await adminTemplateService.deleteTemplate(req.params.id);
  sendSuccess(res);
};

// POST /admin/templates/:id/versions — compile + store a Draft. 400 with the exact compiler
// message on failure.
export const createVersion = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const input = parseCreateVersion(requireObjectBody(req.body));
  sendSuccess(res, await adminTemplateService.createVersion(req.params.id, input), 201);
};

export const getVersion = async (
  req: Request<{ id: string; v: string }>,
  res: Response
): Promise<void> => {
  sendSuccess(res, await adminTemplateService.getVersion(req.params.id, versionParam(req.params.v)));
};

export const publishVersion = async (
  req: Request<{ id: string; v: string }>,
  res: Response
): Promise<void> => {
  sendSuccess(res, await adminTemplateService.publishVersion(req.params.id, versionParam(req.params.v)));
};

// POST /admin/media — image -> WebP (two sizes) -> S3 (for template thumbnails).
export const uploadMedia = async (req: Request, res: Response): Promise<void> => {
  const file = req.file;
  if (!file) throw new BadRequestError('Expected a multipart form field named "file".');
  sendSuccess(res, await adminTemplateService.uploadMedia({ mimeType: file.mimetype, buffer: file.buffer }), 201);
};
