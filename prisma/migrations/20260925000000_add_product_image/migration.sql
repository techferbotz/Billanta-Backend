-- AlterTable: product photos (APP-015 / BE-020). The url + thumbnailUrl pair from POST /media,
-- mirroring Company.logoUrl / logoThumbnailUrl. Nullable, so existing products need no backfill.
ALTER TABLE "Product" ADD COLUMN     "imageThumbnailUrl" TEXT,
ADD COLUMN     "imageUrl" TEXT;
