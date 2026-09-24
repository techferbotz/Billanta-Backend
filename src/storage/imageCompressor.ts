import sharp from "sharp";

// The ONLY file importing sharp. Produces two WebP derivatives of an uploaded image — a
// full size for the invoice/preview and a small thumbnail for pickers/lists.

const MAX_DIMENSION = 1280; // px — longest edge of the FULL image
const THUMB_DIMENSION = 512; // px — longest edge of the THUMBNAIL
const WEBP_QUALITY = 75; // full image: strong quality, big size win vs source JPEG/PNG
const THUMB_QUALITY = 60; // thumbnail: lower quality is fine at small size

export const COMPRESSED_IMAGE_MIME = "image/webp";
export const COMPRESSED_IMAGE_EXT = "webp";

// Compress + downscale to WebP within `maxDimension` (longest edge). `.rotate()` bakes in
// EXIF orientation (so a portrait phone photo of a signature isn't sideways) and strips
// metadata. Never enlarges a smaller source.
async function toWebp(buffer: Buffer, maxDimension: number, quality: number): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .resize({ width: maxDimension, height: maxDimension, fit: "inside", withoutEnlargement: true })
    .webp({ quality })
    .toBuffer();
}

// Full-size image (≤1280px) — shown on the invoice / preview.
export async function compressImage(buffer: Buffer): Promise<Buffer> {
  return toWebp(buffer, MAX_DIMENSION, WEBP_QUALITY);
}

// Small thumbnail (≤512px) — logo/customer pickers and lists. Generated from the ORIGINAL
// buffer (not the full WebP) so each derivative downscales once, at best quality.
export async function compressThumbnail(buffer: Buffer): Promise<Buffer> {
  return toWebp(buffer, THUMB_DIMENSION, THUMB_QUALITY);
}

// Template-picker thumbnail (APP-012): a rendered page, exactly `width` px wide at its own aspect
// ratio. Deliberately NOT the ≤512px bound above — that caps the long side, which for a portrait
// page comes out ~362px wide, visibly soft on a phone's grid card. Flattened onto opaque white:
// some cards are near-black, so no transparent pixel may survive. Small text needs more quality
// than a photo thumbnail; at 82 an A4 page still lands near 30 KB.
const PAGE_THUMB_QUALITY = 82;

export async function compressPageThumbnail(png: Buffer, width: number): Promise<Buffer> {
  return sharp(png)
    .flatten({ background: "#ffffff" })
    .resize({ width })
    .webp({ quality: PAGE_THUMB_QUALITY })
    .toBuffer();
}
