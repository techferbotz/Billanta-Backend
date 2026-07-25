import { Template, TemplateVersion } from "@prisma/client";
import { BadRequestError } from "../../../common/errors/AppError";
import { optionalString, requireString } from "../../../common/validation";

// --- request parsers ----------------------------------------------------------------

export interface CreateTemplateInput {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  thumbnailUrl: string | null;
  isPremium: boolean;
  orderIndex: number;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const optionalBool = (value: unknown, field: string): boolean | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new BadRequestError(`"${field}" must be a boolean`);
  return value;
};

const optionalInt = (value: unknown, field: string): number | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new BadRequestError(`"${field}" must be an integer`);
  }
  return value;
};

export const parseCreateTemplate = (body: Record<string, unknown>): CreateTemplateInput => {
  const id = requireString(body.id, "id", 60).toLowerCase();
  if (!SLUG.test(id)) {
    throw new BadRequestError('"id" must be a slug (lowercase letters, digits, hyphens), e.g. "classic"');
  }
  return {
    id,
    name: requireString(body.name, "name", 120),
    description: optionalString(body.description, "description", 500) ?? null,
    category: optionalString(body.category, "category", 60) ?? null,
    thumbnailUrl: optionalString(body.thumbnailUrl, "thumbnailUrl", 1000) ?? null,
    isPremium: optionalBool(body.isPremium, "isPremium") ?? false,
    orderIndex: optionalInt(body.orderIndex, "orderIndex") ?? 0,
  };
};

export interface UpdateTemplateInput {
  name?: string;
  description?: string | null;
  category?: string | null;
  thumbnailUrl?: string | null;
  isPremium?: boolean;
  isActive?: boolean;
  orderIndex?: number;
}

export const parseUpdateTemplate = (body: Record<string, unknown>): UpdateTemplateInput => {
  const out: UpdateTemplateInput = {};
  if ("name" in body) out.name = requireString(body.name, "name", 120);
  if ("description" in body) out.description = optionalString(body.description, "description", 500) ?? null;
  if ("category" in body) out.category = optionalString(body.category, "category", 60) ?? null;
  if ("thumbnailUrl" in body) out.thumbnailUrl = optionalString(body.thumbnailUrl, "thumbnailUrl", 1000) ?? null;
  if ("isPremium" in body) out.isPremium = optionalBool(body.isPremium, "isPremium");
  if ("isActive" in body) out.isActive = optionalBool(body.isActive, "isActive");
  if ("orderIndex" in body) out.orderIndex = optionalInt(body.orderIndex, "orderIndex");
  return out;
};

export interface CreateVersionInput {
  html: string;
  css: string;
}

export const parseCreateVersion = (body: Record<string, unknown>): CreateVersionInput => ({
  // Templates can be large; allow generous lengths.
  html: requireString(body.html, "html", 100_000),
  // CSS may legitimately be empty (all styling inline), so accept "".
  css: typeof body.css === "string" ? body.css : "",
});

// --- response mappers ---------------------------------------------------------------

export interface AdminTemplateDto {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  thumbnailUrl: string | null;
  isPremium: boolean;
  isActive: boolean;
  orderIndex: number;
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const toAdminTemplateDto = (t: Template): AdminTemplateDto => ({
  id: t.id,
  name: t.name,
  description: t.description,
  category: t.category,
  thumbnailUrl: t.thumbnailUrl,
  isPremium: t.isPremium,
  isActive: t.isActive,
  orderIndex: t.orderIndex,
  currentVersionId: t.currentVersionId,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
});

// Version summary (list) — no source/compiled payloads.
export interface AdminVersionSummaryDto {
  id: string;
  version: number;
  status: string;
  compilerVersion: number;
  checksum: string;
  publishedAt: string | null;
  createdAt: string;
}

export const toVersionSummary = (v: TemplateVersion): AdminVersionSummaryDto => ({
  id: v.id,
  version: v.version,
  status: v.status,
  compilerVersion: v.compilerVersion,
  checksum: v.checksum,
  publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
  createdAt: v.createdAt.toISOString(),
});

// Full version detail (review) — includes source + compiled JSON.
export interface AdminVersionDetailDto extends AdminVersionSummaryDto {
  sourceHtml: string;
  sourceCss: string;
  compiled: unknown;
}

export const toVersionDetail = (v: TemplateVersion): AdminVersionDetailDto => ({
  ...toVersionSummary(v),
  sourceHtml: v.sourceHtml,
  sourceCss: v.sourceCss,
  compiled: v.compiled,
});
