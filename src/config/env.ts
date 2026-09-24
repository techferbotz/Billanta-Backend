import dotenv from "dotenv";

// Load variables from .env into process.env as early as possible.
// `quiet` suppresses dotenv v17's startup banner (and the harmless "injected env (0)"
// line in containers, where env vars come from the platform rather than a .env file).
dotenv.config({ quiet: true });

// Fail fast if a required variable is missing, so the app never boots with an undefined
// secret or connection string. Throwing here crashes the process at startup — which is
// exactly what we want: a crash-loop is loud, a silently-unset JWT secret is not.
const requireEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

// Parses an OPTIONAL env var holding a JSON object. Unset/blank -> null. Invalid JSON or a
// non-object -> throw, so a mistyped value fails the boot (like requireEnv) instead of being
// quietly ignored.
const parseJsonObjectEnv = (key: string): Record<string, unknown> | null => {
  const raw = process.env[key];
  if (!raw || !raw.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Environment variable ${key} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Environment variable ${key} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
};

// Parses an OPTIONAL env var holding a public ORIGIN (scheme + host [+ port], nothing else),
// falling back when unset/blank. A trailing slash is tolerated and stripped, so callers append
// paths. Anything else — not a URL, not http(s), or carrying a path/query — throws at startup,
// like requireEnv, instead of quietly producing broken absolute links at runtime.
const parseOriginEnv = (key: string, fallback: string): string => {
  const raw = process.env[key]?.trim() || fallback;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Environment variable ${key} is not a valid absolute URL: "${raw}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Environment variable ${key} must be an http(s) URL: "${raw}"`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`Environment variable ${key} must be a bare origin with no path: "${raw}"`);
  }
  return url.origin;
};

// Centralized, typed configuration. Import this instead of reading process.env
// directly — nothing else in the codebase may touch process.env.
export const config = {
  port: process.env.PORT ? Number(process.env.PORT) : 3000,

  // The public origin this backend is served from. It is the ONE place absolute URLs are built
  // from — today the legal pages' links handed to the app in GET /config (`links.*`), so a page
  // can move hosts with an env change instead of an app release (HOA protocol 12). No trailing
  // slash. Defaults to production, so dev and check scripts get real, working links.
  publicUrl: parseOriginEnv("APP_PUBLIC_URL", "https://billanta.ferbotz.com"),

  // --- Required: the app refuses to start without these ---------------------------
  databaseUrl: requireEnv("DATABASE_URL"),
  // Secret for signing/verifying the short-lived ACCESS token. Refresh tokens are opaque
  // random strings, not JWTs, so they don't use this.
  jwtSecret: requireEnv("JWT_SECRET"),
  // The OAuth client id every Google idToken must be issued for. Checked as the `aud`
  // claim during server-side verification — an idToken minted for a different client is
  // rejected. Without this check, sign-in is a full account-takeover hole.
  googleClientId: requireEnv("GOOGLE_CLIENT_ID"),
  // Bearer secret for the template-authoring API (`/admin/*`). Held by the operator only,
  // never shipped to clients. Generate a long random value: `openssl rand -hex 32`.
  adminApiKey: requireEnv("ADMIN_API_KEY"),

  // --- Optional: sensible defaults ------------------------------------------------
  // Access-token lifetime. Deliberately short: a leaked access token expires quickly,
  // and the refresh-token rotation flow is what provides long-lived sessions.
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? "15m",
  // Refresh-token lifetime in days. Long, because an offline-first app may go weeks
  // between syncs and shouldn't silently log the user out.
  refreshTokenTtlDays: process.env.REFRESH_TOKEN_TTL_DAYS
    ? Number(process.env.REFRESH_TOKEN_TTL_DAYS)
    : 60,

  // Optional AWS S3 for media (logos, signatures, QR images, template thumbnails).
  // When S3_BUCKET or AWS_REGION is unset, media uploads are DISABLED: POST /media
  // returns a clear 503 and every other endpoint keeps working. Credentials come from
  // the AWS default provider chain — the EC2 instance's IAM role in production, so no
  // access keys ever live in env.
  s3Bucket: process.env.S3_BUCKET || null,
  s3Region: process.env.AWS_REGION || process.env.S3_REGION || null,
  // Optional CDN/custom base URL (e.g. a CloudFront domain) in front of the bucket;
  // falls back to the direct S3 URL. No trailing slash.
  s3PublicBaseUrl: process.env.S3_PUBLIC_BASE_URL || null,

  // Optional hardcoded credentials for the admin panel served at GET /admin. The page
  // posts these to POST /admin/login, which checks them SERVER-SIDE and only then hands
  // back ADMIN_API_KEY for the browser session. The key is never baked into the HTML.
  // Unset => panel login is disabled (the authoring API still works with the key).
  adminPanelUser: process.env.ADMIN_PANEL_USER || null,
  adminPanelPassword: process.env.ADMIN_PANEL_PASSWORD || null,

  // Optional JSON patch applied over the default remote config (GET /config) for every caller,
  // e.g. {"maintenance":{"enabled":true,"message":"Back in 10 minutes"}}. Lets ops flip a flag
  // with an .env change + container recreate — no code deploy. Every key must exist in
  // DEFAULT_REMOTE_CONFIG with a matching type; anything else fails startup on purpose
  // (validated in remoteConfig.service.ts). See docs/REMOTE_CONFIG.md.
  remoteConfigOverrides: parseJsonObjectEnv("REMOTE_CONFIG_OVERRIDES"),
};
