import { TemplateVersionStatus } from "@prisma/client";
import { templateRepository } from "../repository/template.repository";
import { PageParams, PaginatedResult } from "../../../common/pagination";
import { userRepository } from "../../user/repository/user.repository";
import { ForbiddenError, NotFoundError } from "../../../common/errors/AppError";
import {
  TemplateDetailDto,
  TemplateListItemDto,
  toDetailDto,
  toListItemDto,
} from "../dto/template.dto";

// Returned by getCompiled; the controller turns it into an ETag-aware response.
export interface CompiledResult {
  version: number;
  checksum: string;
  compiled: unknown; // the stored Billanta Template JSON
  immutable: boolean; // true when a SPECIFIC version was requested (safe to cache forever)
  // True for a premium template. The response is authenticated (premium was enforced), so it
  // must NEVER be marked `public` — a shared CDN/proxy caching it would serve the paid render
  // tree to anonymous callers, bypassing the paywall. The controller emits `private` for these.
  isPremium: boolean;
}

export class TemplateService {
  // A page of active templates for the picker, each annotated with its current version + checksum.
  async list(page: PageParams): Promise<PaginatedResult<TemplateListItemDto>> {
    const result = await templateRepository.listActive(page);
    const currents = await templateRepository.currentVersionsFor(result.items);
    return {
      ...result,
      items: result.items.map((t) =>
        toListItemDto(t, t.currentVersionId ? currents.get(t.currentVersionId) : undefined)
      ),
    };
  }

  async getById(id: string): Promise<TemplateDetailDto> {
    const template = await templateRepository.findById(id);
    // Inactive templates are invisible to clients — treat as not found.
    if (!template || !template.isActive) throw new NotFoundError("Template not found");
    const current = template.currentVersionId
      ? (await templateRepository.findVersionById(template.currentVersionId)) ?? undefined
      : undefined;
    return toDetailDto(template, current);
  }

  /**
   * Resolve the compiled tree a client should download.
   *
   * Premium is ENFORCED here: a premium template is refused (403 PREMIUM_REQUIRED) unless the
   * caller is signed in AND isPremium. The template still appears in listings for upsell, but
   * the render tree — the thing of value — is gated.
   *
   * Version resolution: an explicit `?version=` returns that exact version if it has ever been
   * published (Published or Archived — both are immutable and may be in a client's cache);
   * a Draft is never served publicly. With no version, the current Published version is served.
   */
  async getCompiled(
    templateId: string,
    requestedVersion: number | undefined,
    userId: string | null
  ): Promise<CompiledResult> {
    const template = await templateRepository.findById(templateId);
    if (!template || !template.isActive) throw new NotFoundError("Template not found");

    if (template.isPremium) {
      const premium = userId ? (await userRepository.findById(userId))?.isPremium === true : false;
      if (!premium) {
        throw new ForbiddenError("This template requires a premium subscription", "PREMIUM_REQUIRED");
      }
    }

    if (requestedVersion !== undefined) {
      const version = await templateRepository.findVersion(templateId, requestedVersion);
      if (!version || version.status === TemplateVersionStatus.Draft) {
        throw new NotFoundError("Template version not found");
      }
      return {
        version: version.version,
        checksum: version.checksum,
        compiled: version.compiled,
        immutable: true,
        isPremium: template.isPremium,
      };
    }

    if (!template.currentVersionId) {
      throw new NotFoundError("Template has no published version yet");
    }
    const current = await templateRepository.findVersionById(template.currentVersionId);
    if (!current) throw new NotFoundError("Template has no published version yet");
    return {
      version: current.version,
      checksum: current.checksum,
      compiled: current.compiled,
      immutable: false,
      isPremium: template.isPremium,
    };
  }
}

export const templateService = new TemplateService();
