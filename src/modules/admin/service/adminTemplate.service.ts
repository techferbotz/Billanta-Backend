import crypto from "crypto";
import { config } from "../../../config/env";
import {
  templateRepository,
  PublishError,
} from "../../template/repository/template.repository";
import { mediaService, MediaResult } from "../../media/service/media.service";
import { compileTemplate } from "../../../templates/compile/compiler";
import { CompileError } from "../../../templates/compile/errors";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
} from "../../../common/errors/AppError";
import {
  AdminTemplateDto,
  AdminVersionDetailDto,
  AdminVersionSummaryDto,
  CreateTemplateInput,
  CreateVersionInput,
  UpdateTemplateInput,
  toAdminTemplateDto,
  toVersionDetail,
  toVersionSummary,
} from "../dto/admin.dto";

// Constant-time string compare that also resists length leaks (hash both sides first).
const safeEqual = (a: string, b: string): boolean => {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
};

export class AdminTemplateService {
  /**
   * Validate the panel's hardcoded credentials SERVER-SIDE and, only on a match, hand back the
   * ADMIN_API_KEY for the browser session. The key is never embedded in the served page.
   */
  login(username: string, password: string): { apiKey: string } {
    if (!config.adminPanelUser || !config.adminPanelPassword) {
      throw new ServiceUnavailableError("Admin panel login is not configured on this server");
    }
    const okUser = safeEqual(username, config.adminPanelUser);
    const okPass = safeEqual(password, config.adminPanelPassword);
    if (!okUser || !okPass) {
      throw new UnauthorizedError("Invalid admin credentials");
    }
    return { apiKey: config.adminApiKey };
  }

  async listTemplates(): Promise<AdminTemplateDto[]> {
    const templates = await templateRepository.listAll();
    return templates.map(toAdminTemplateDto);
  }

  async createTemplate(input: CreateTemplateInput): Promise<AdminTemplateDto> {
    const existing = await templateRepository.findById(input.id);
    if (existing) throw new ConflictError(`A template with id "${input.id}" already exists`);
    const template = await templateRepository.createTemplate(input);
    return toAdminTemplateDto(template);
  }

  async updateTemplate(id: string, input: UpdateTemplateInput): Promise<AdminTemplateDto> {
    await this.requireTemplate(id);
    const template = await templateRepository.updateTemplate(id, input);
    return toAdminTemplateDto(template);
  }

  async getTemplate(id: string): Promise<{ template: AdminTemplateDto; versions: AdminVersionSummaryDto[] }> {
    const template = await this.requireTemplate(id);
    const versions = await templateRepository.listVersions(id);
    return { template: toAdminTemplateDto(template), versions: versions.map(toVersionSummary) };
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.requireTemplate(id);
    await templateRepository.deleteTemplate(id);
  }

  /**
   * Compile authored HTML+CSS and store it as a new Draft version.
   *
   * A compile failure is a 400 carrying the compiler's exact, located message
   * (`css: unsupported property "animation" in rule ".header" (line 12)`) and the code
   * TEMPLATE_COMPILE_FAILED — the template is NEVER stored on failure.
   */
  async createVersion(id: string, input: CreateVersionInput): Promise<AdminVersionDetailDto> {
    await this.requireTemplate(id);

    let result;
    try {
      result = compileTemplate(input.html, input.css);
    } catch (err) {
      if (err instanceof CompileError) {
        throw new BadRequestError(err.message, "TEMPLATE_COMPILE_FAILED");
      }
      throw err;
    }

    const version = await templateRepository.createVersion({
      templateId: id,
      sourceHtml: input.html,
      sourceCss: input.css,
      compiled: result.compiled, // plain object; the repository casts to Prisma's JSON type
      compilerVersion: result.compilerVersion,
      checksum: result.checksum,
    });
    return toVersionDetail(version);
  }

  async getVersion(id: string, version: number): Promise<AdminVersionDetailDto> {
    const found = await templateRepository.findVersion(id, version);
    if (!found) throw new NotFoundError("Template version not found");
    return toVersionDetail(found);
  }

  async publishVersion(id: string, version: number): Promise<AdminVersionSummaryDto> {
    const found = await templateRepository.findVersion(id, version);
    if (!found) throw new NotFoundError("Template version not found");
    try {
      const published = await templateRepository.publishVersion(id, found.id);
      return toVersionSummary(published);
    } catch (err) {
      if (err instanceof PublishError) {
        if (err.reason === "ALREADY_PUBLISHED") throw new ConflictError("Version is already published");
        throw new NotFoundError("Template or version not found");
      }
      throw err;
    }
  }

  // Admin media (template thumbnails). Reuses the shared media pipeline under a fixed prefix,
  // since admin uploads aren't owned by a user.
  async uploadMedia(file: { mimeType: string; buffer: Buffer }): Promise<MediaResult> {
    return mediaService.upload("templates", file);
  }

  private async requireTemplate(id: string) {
    const template = await templateRepository.findById(id);
    if (!template) throw new NotFoundError("Template not found");
    return template;
  }
}

export const adminTemplateService = new AdminTemplateService();
