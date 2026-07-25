import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { config } from "../config/env";

// Isolated AWS S3 access — the ONLY file importing @aws-sdk/client-s3, so the storage
// vendor stays swappable behind this one boundary. Billanta stores logos, signatures, QR
// images and template thumbnails here.
//
// Credentials come from the AWS DEFAULT PROVIDER CHAIN: on EC2 that's the instance's IAM
// role (no keys in env — the recommended setup); locally it's AWS_ACCESS_KEY_ID/SECRET or
// ~/.aws. If S3_BUCKET or AWS_REGION is unset, storage is DISABLED: `enabled` is false,
// `upload()` returns null, and POST /media reports a clean 503 while the rest of the app
// keeps working. Objects are served publicly via a bucket policy or CloudFront
// (S3_PUBLIC_BASE_URL) — no per-object ACL is set (modern buckets have ACLs disabled).
class S3Storage {
  private readonly bucket: string | null;
  private readonly region: string | null;
  private readonly publicBase: string | null;
  private readonly client: S3Client | null;

  constructor() {
    this.bucket = config.s3Bucket;
    this.region = config.s3Region;

    if (this.bucket && !this.region) {
      console.warn("[s3Storage] S3_BUCKET set but AWS_REGION missing — media uploads disabled.");
    }
    if (!this.bucket) {
      console.warn("[s3Storage] S3_BUCKET not set — media uploads are disabled.");
    }

    const enabled = Boolean(this.bucket && this.region);
    this.client = enabled ? new S3Client({ region: this.region as string }) : null;
    this.publicBase = enabled
      ? (config.s3PublicBaseUrl?.replace(/\/+$/, "") ??
        `https://${this.bucket}.s3.${this.region}.amazonaws.com`)
      : null;
  }

  get enabled(): boolean {
    return this.client !== null && this.bucket !== null && this.publicBase !== null;
  }

  // Upload bytes and return the public URL, or null when disabled.
  //
  // THROWS on a real S3 failure (unlike a best-effort uploader): the caller needs to know
  // an upload failed rather than silently storing a null URL against a logo. A long
  // immutable Cache-Control is safe because keys embed a fresh uuid per upload.
  async upload(buffer: Buffer, contentType: string, key: string): Promise<string | null> {
    if (!this.client || !this.bucket || !this.publicBase) return null;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
    return `${this.publicBase}/${key}`;
  }

  // Best-effort delete by key (for future media cleanup). Never throws.
  async delete(keys: string[]): Promise<void> {
    if (!this.client || !this.bucket || keys.length === 0) return;
    const bucket = this.bucket;
    await Promise.allSettled(
      keys.map((Key) => this.client!.send(new DeleteObjectCommand({ Bucket: bucket, Key })))
    );
  }
}

export const s3Storage = new S3Storage();
