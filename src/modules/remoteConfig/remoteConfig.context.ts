import { Request } from "express";
import { ConfigContext, Platform } from "./dto/remoteConfig.dto";

// Optional headers describing the build that is asking. The app should send them on GET /config
// (ideally on every request, so future per-version behaviour can key on them elsewhere too).
// Missing or garbled values degrade to null / "unknown" — never a 400 — because the config
// must always be fetchable; a rule that needs a value the caller did not send simply won't match.
// The same goes for identity: the JWT is optional on this route (optionalAuth), so userId may
// be null too.
export const APP_VERSION_HEADER = "X-App-Version"; // display version, e.g. "1.4.2"
export const APP_BUILD_HEADER = "X-App-Build"; // integer build / versionCode, e.g. "1042"
export const APP_PLATFORM_HEADER = "X-App-Platform"; // "android" | "ios" | "web"
export const DEVICE_ID_HEADER = "X-Device-Id"; // stable per-install id — the bucketing key

const PLATFORMS: readonly string[] = ["android", "ios", "web"];

// Billanta has no device concept anywhere else (ownership is by userId alone — see
// types/express.d.ts), so unlike the HOA reference implementation there is no middleware to
// attach an install id: X-Device-Id is read here, as one more optional header, and used only
// for experiment bucketing. `identity` therefore carries just the authenticated user.
export interface RawContextHeaders {
  platform?: string;
  version?: string;
  build?: string;
  deviceId?: string;
}

const parsePlatform = (raw: string | undefined): Platform => {
  const v = raw?.trim().toLowerCase() ?? "";
  return PLATFORMS.includes(v) ? (v as Platform) : "unknown";
};

// A build number is a non-negative integer. Anything else ("", "1.2", "abc", too long) -> null.
const parseBuild = (raw: string | undefined): number | null => {
  const v = raw?.trim() ?? "";
  return /^\d{1,12}$/.test(v) ? Number(v) : null;
};

// Kept as an opaque string; capped because it is for logging, not parsing.
const parseVersion = (raw: string | undefined): string | null => {
  const v = raw?.trim() ?? "";
  return v ? v.slice(0, 32) : null;
};

// Opaque too: whatever the install calls itself (a uuid today). Capped so a huge header can't
// become a huge hash input; blank -> null, so a client that sends an empty header is simply
// treated as having sent nothing.
const parseDeviceId = (raw: string | undefined): string | null => {
  const v = raw?.trim() ?? "";
  return v ? v.slice(0, 128) : null;
};

// Pure half — what the check:config script exercises.
export const parseContextHeaders = (
  headers: RawContextHeaders,
  identity: { userId: string | null }
): ConfigContext => ({
  deviceId: parseDeviceId(headers.deviceId),
  userId: identity.userId,
  platform: parsePlatform(headers.platform),
  appVersion: parseVersion(headers.version),
  appBuild: parseBuild(headers.build),
});

// Express half. Identity comes from what the route's middleware attached: req.userId
// (optionalAuth), which may be absent.
export const contextFromRequest = (req: Request): ConfigContext =>
  parseContextHeaders(
    {
      platform: req.header(APP_PLATFORM_HEADER),
      version: req.header(APP_VERSION_HEADER),
      build: req.header(APP_BUILD_HEADER),
      deviceId: req.header(DEVICE_ID_HEADER),
    },
    { userId: req.userId ?? null }
  );
