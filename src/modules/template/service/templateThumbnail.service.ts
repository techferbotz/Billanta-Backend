import crypto from "crypto";
import { TemplateVersion } from "@prisma/client";
import { templateRepository } from "../repository/template.repository";
import { CompiledTemplate } from "../../../templates/compile/nodes";
import { renderThumbnailPng, THUMBNAIL_WIDTH } from "../../../templates/render/renderThumbnail";
import { compressPageThumbnail, COMPRESSED_IMAGE_MIME, COMPRESSED_IMAGE_EXT } from "../../../storage/imageCompressor";
import { s3Storage } from "../../../storage/s3Storage";

// Template-picker thumbnails (APP-012): page 1 of a version, filled with the fixed sample invoice,
// stored as a public WebP and served as `thumbnailUrl` on GET /templates.
//
// NEVER THROWS. A publish must not fail because its thumbnail did (APP-012 §5): every failure is
// caught, recorded on the version (the admin panel shows it with a retry button), and returned as
// an outcome. The template keeps serving its previous thumbnail meanwhile — a slightly stale picture
// beats a blank card.

export type ThumbnailOutcome =
  | { status: "ok"; url: string; reused: boolean }
  | { status: "failed"; error: string };

export class TemplateThumbnailService {
  /**
   * Called once a publish has committed. A version that already has a thumbnail (a rollback to an
   * archived version, or a draft rendered before publishing) reuses it — its tree can't have
   * changed, so neither can its picture. Otherwise it's rendered now.
   */
  async afterPublish(templateId: string, version: TemplateVersion): Promise<ThumbnailOutcome> {
    if (version.thumbnailUrl) {
      try {
        await templateRepository.promoteThumbnail(templateId, version.id, version.thumbnailUrl);
        return { status: "ok", url: version.thumbnailUrl, reused: true };
      } catch (err) {
        return this.fail(templateId, version, err);
      }
    }
    return this.generate(templateId, version);
  }

  /** Render, store and record a version's thumbnail — also the admin panel's "retry". */
  async generate(templateId: string, version: TemplateVersion): Promise<ThumbnailOutcome> {
    try {
      if (!s3Storage.enabled) throw new Error("media storage is not configured (S3_BUCKET / AWS_REGION)");

      const png = await renderThumbnailPng(version.compiled as unknown as CompiledTemplate, THUMBNAIL_WIDTH);
      const webp = await compressPageThumbnail(png, THUMBNAIL_WIDTH);

      // The key embeds the version AND a hash of the bytes, so the URL changes whenever the image
      // does (APP-012 §3): the app caches images by URL, forever. Identical bytes map to the same key,
      // so a retry of an unchanged render rewrites the same object with the same content — harmless.
      const hash = crypto.createHash("sha256").update(webp).digest("hex").slice(0, 16);
      const key = `templates/${templateId}/thumbnails/v${version.version}-${hash}.${COMPRESSED_IMAGE_EXT}`;
      const url = await s3Storage.upload(webp, COMPRESSED_IMAGE_MIME, key);
      if (!url) throw new Error("media storage returned no URL");

      await templateRepository.recordThumbnail(version.id, url);
      await templateRepository.promoteThumbnail(templateId, version.id, url);
      return { status: "ok", url, reused: false };
    } catch (err) {
      return this.fail(templateId, version, err);
    }
  }

  private async fail(templateId: string, version: TemplateVersion, err: unknown): Promise<ThumbnailOutcome> {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    console.error(`[thumbnail] ${templateId} v${version.version} failed: ${error}`);
    // Best effort: if even recording the failure fails, the outcome still reports it.
    await templateRepository.recordThumbnailError(version.id, error).catch(() => undefined);
    return { status: "failed", error };
  }
}

export const templateThumbnailService = new TemplateThumbnailService();
