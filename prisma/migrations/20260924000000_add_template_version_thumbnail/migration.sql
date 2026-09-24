-- AlterTable: per-version picker thumbnails (APP-012 / BE-016). Derived artifacts, not part of the
-- immutable render tree; a successful render for the current version is also copied to
-- "Template"."thumbnailUrl", which GET /templates already serves.
ALTER TABLE "TemplateVersion" ADD COLUMN     "thumbnailUrl" TEXT,
ADD COLUMN     "thumbnailError" TEXT,
ADD COLUMN     "thumbnailAt" TIMESTAMP(3);
