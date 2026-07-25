import { Template, TemplateVersion } from "@prisma/client";

/// A template in the picker list. `currentVersion` + `checksum` let the client decide whether
/// its cached compiled tree is stale without downloading it.
export interface TemplateListItemDto {
  id: string;
  name: string;
  category: string | null;
  thumbnailUrl: string | null;
  isPremium: boolean;
  currentVersion: number | null;
  checksum: string | null;
}

/// Full template detail.
export interface TemplateDetailDto {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  thumbnailUrl: string | null;
  isPremium: boolean;
  isActive: boolean;
  currentVersion: number | null;
  checksum: string | null;
  createdAt: string;
  updatedAt: string;
}

export const toListItemDto = (
  t: Template,
  current: TemplateVersion | undefined
): TemplateListItemDto => ({
  id: t.id,
  name: t.name,
  category: t.category,
  thumbnailUrl: t.thumbnailUrl,
  isPremium: t.isPremium,
  currentVersion: current?.version ?? null,
  checksum: current?.checksum ?? null,
});

export const toDetailDto = (
  t: Template,
  current: TemplateVersion | undefined
): TemplateDetailDto => ({
  id: t.id,
  name: t.name,
  description: t.description,
  category: t.category,
  thumbnailUrl: t.thumbnailUrl,
  isPremium: t.isPremium,
  isActive: t.isActive,
  currentVersion: current?.version ?? null,
  checksum: current?.checksum ?? null,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
});
