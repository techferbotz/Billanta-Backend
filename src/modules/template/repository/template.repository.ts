import { Prisma, Template, TemplateVersion, TemplateVersionStatus } from "@prisma/client";
import { prisma } from "../../../prisma/client";

// All Template / TemplateVersion database access — shared by the public template module
// (read-only serving) and the admin authoring module. No Prisma outside this file.

export interface CreateTemplateData {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  thumbnailUrl?: string | null;
  isPremium?: boolean;
  orderIndex?: number;
}

export interface UpdateTemplateData {
  name?: string;
  description?: string | null;
  category?: string | null;
  thumbnailUrl?: string | null;
  isPremium?: boolean;
  isActive?: boolean;
  orderIndex?: number;
}

export interface NewVersionData {
  templateId: string;
  sourceHtml: string;
  sourceCss: string;
  // The Billanta Template JSON as a plain object; cast to Prisma's JSON input type inside
  // createVersion so callers (the admin service) never import Prisma.
  compiled: unknown;
  compilerVersion: number;
  checksum: string;
}

export class TemplateRepository {
  // --- reads (public + admin) -------------------------------------------------------
  // Active templates for the picker, in display order.
  listActive(): Promise<Template[]> {
    return prisma.template.findMany({ where: { isActive: true }, orderBy: [{ orderIndex: "asc" }, { id: "asc" }] });
  }

  // Every template (admin listing), active or not.
  listAll(): Promise<Template[]> {
    return prisma.template.findMany({ orderBy: [{ orderIndex: "asc" }, { id: "asc" }] });
  }

  findById(id: string): Promise<Template | null> {
    return prisma.template.findUnique({ where: { id } });
  }

  findVersionById(id: string): Promise<TemplateVersion | null> {
    return prisma.templateVersion.findUnique({ where: { id } });
  }

  findVersion(templateId: string, version: number): Promise<TemplateVersion | null> {
    return prisma.templateVersion.findUnique({
      where: { templateId_version: { templateId, version } },
    });
  }

  listVersions(templateId: string): Promise<TemplateVersion[]> {
    return prisma.templateVersion.findMany({
      where: { templateId },
      orderBy: { version: "desc" },
    });
  }

  // Fetch the current (Published) versions for a set of templates in one query — avoids an
  // N+1 when building the list response.
  async currentVersionsFor(templates: Template[]): Promise<Map<string, TemplateVersion>> {
    const ids = templates.map((t) => t.currentVersionId).filter((v): v is string => v !== null);
    if (ids.length === 0) return new Map();
    const versions = await prisma.templateVersion.findMany({ where: { id: { in: ids } } });
    return new Map(versions.map((v) => [v.id, v]));
  }

  // --- writes (admin) ---------------------------------------------------------------
  createTemplate(data: CreateTemplateData): Promise<Template> {
    return prisma.template.create({ data });
  }

  updateTemplate(id: string, data: UpdateTemplateData): Promise<Template> {
    return prisma.template.update({ where: { id }, data });
  }

  deleteTemplate(id: string): Promise<void> {
    return prisma.template.delete({ where: { id } }).then(() => undefined);
  }

  /**
   * Create the next Draft version for a template.
   *
   * The version number is max(existing)+1, computed inside a transaction so two concurrent
   * creates can't mint the same number (the @@unique([templateId, version]) would also catch
   * it, but computing in-txn avoids a spurious failure for the single admin operator).
   */
  createVersion(data: NewVersionData): Promise<TemplateVersion> {
    return prisma.$transaction(async (tx) => {
      const max = await tx.templateVersion.aggregate({
        where: { templateId: data.templateId },
        _max: { version: true },
      });
      const version = (max._max.version ?? 0) + 1;
      return tx.templateVersion.create({
        data: {
          templateId: data.templateId,
          version,
          status: TemplateVersionStatus.Draft,
          sourceHtml: data.sourceHtml,
          sourceCss: data.sourceCss,
          compiled: data.compiled as Prisma.InputJsonValue,
          compilerVersion: data.compilerVersion,
          checksum: data.checksum,
        },
      });
    });
  }

  /**
   * Publish a Draft version and make it the template's current version.
   *
   * Atomic: archive whatever version was current, flip this one to Published with a timestamp,
   * and repoint the template. Published versions are never mutated after this — a later edit
   * creates a brand-new version instead.
   */
  publishVersion(templateId: string, versionId: string): Promise<TemplateVersion> {
    return prisma.$transaction(async (tx) => {
      // Lock the Template row FIRST. Without this, two concurrent publishes both read the same
      // stale currentVersionId under Read Committed, each archive the OLD current instead of
      // each other, and end with two Published versions (one orphaned). The row lock serializes
      // them so the second publish sees the first's committed currentVersionId.
      await tx.$queryRaw`SELECT id FROM "Template" WHERE id = ${templateId} FOR UPDATE`;

      const template = await tx.template.findUnique({ where: { id: templateId } });
      if (!template) throw new PublishError("TEMPLATE_NOT_FOUND");

      const version = await tx.templateVersion.findUnique({ where: { id: versionId } });
      if (!version || version.templateId !== templateId) throw new PublishError("VERSION_NOT_FOUND");
      // Re-publishing the version that is ALREADY current is a no-op conflict. (An Archived
      // version may be re-published to roll back to it — that's allowed.)
      if (template.currentVersionId === versionId) throw new PublishError("ALREADY_PUBLISHED");

      // Archive the previously current version, if any.
      if (template.currentVersionId) {
        await tx.templateVersion.update({
          where: { id: template.currentVersionId },
          data: { status: TemplateVersionStatus.Archived },
        });
      }

      const published = await tx.templateVersion.update({
        where: { id: versionId },
        data: {
          status: TemplateVersionStatus.Published,
          // Keep the ORIGINAL first-publish timestamp on a rollback; only stamp it on the
          // first publish of a Draft.
          publishedAt: version.publishedAt ?? new Date(),
        },
      });
      await tx.template.update({ where: { id: templateId }, data: { currentVersionId: versionId } });
      return published;
    });
  }
}

// Sentinel thrown inside publishVersion's transaction; the service maps it to a 404/409.
export class PublishError extends Error {
  constructor(public readonly reason: "TEMPLATE_NOT_FOUND" | "VERSION_NOT_FOUND" | "ALREADY_PUBLISHED") {
    super(reason);
    this.name = "PublishError";
    Object.setPrototypeOf(this, PublishError.prototype);
  }
}

export const templateRepository = new TemplateRepository();
