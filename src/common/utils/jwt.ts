import jwt from "jsonwebtoken";
import crypto from "crypto";
import { config } from "../../config/env";

// Billanta issues TWO credentials, and they are deliberately different things:
//
//   access token  — a short-lived JWT (default 15m). Stateless, never stored server-side.
//                   Its blast radius if leaked is one quarter of an hour.
//   refresh token — an opaque 256-bit random string (NOT a JWT), long-lived (default 60d),
//                   stored only as a SHA-256 hash and rotated on every use.
//
// Making the refresh token opaque rather than a JWT is what makes revocation possible:
// a JWT is valid until it expires no matter what the database says, which is unacceptable
// for a 60-day credential.

// ---------------------------------------------------------------------------------
// Access token
// ---------------------------------------------------------------------------------

// What we put inside the access JWT. `type` is checked on verify so a token minted for
// some future purpose (e.g. an email-verification link) can never be replayed as an
// access token.
export interface AccessTokenPayload {
  userId: string;
  type: "access";
}

// Parse a duration like "15m" / "2h" / "7d" / "900" (bare = seconds) into seconds.
//
// We convert to a NUMBER before handing it to jsonwebtoken rather than passing the string
// through, for two reasons: `expiresIn` in the auth response has to be a number of
// seconds anyway, and a typo in ACCESS_TOKEN_TTL fails loudly here at startup instead of
// silently minting a token with an unexpected lifetime.
const parseDurationToSeconds = (value: string): number => {
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!match) {
    throw new Error(
      `Invalid duration "${value}" — expected a number optionally followed by s, m, h or d (e.g. "15m").`
    );
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "s";
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[unit] as number;
  return amount * multiplier;
};

// Resolved once at module load, so a bad ACCESS_TOKEN_TTL crashes the process at startup
// (same fail-fast contract as config/env.ts) rather than on the first sign-in.
export const ACCESS_TOKEN_TTL_SECONDS = parseDurationToSeconds(config.accessTokenTtl);

// Sign an access token for the given user.
export const generateAccessToken = (userId: string): string => {
  const payload: AccessTokenPayload = { userId, type: "access" };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
};

// Verify an access token and return its payload. Throws if invalid, expired, or if it is
// a token of some other type.
export const verifyAccessToken = (token: string): AccessTokenPayload => {
  const decoded = jwt.verify(token, config.jwtSecret) as Partial<AccessTokenPayload>;
  if (decoded.type !== "access" || typeof decoded.userId !== "string") {
    throw new Error("Not an access token");
  }
  return { userId: decoded.userId, type: "access" };
};

// ---------------------------------------------------------------------------------
// Refresh token
// ---------------------------------------------------------------------------------

// 32 bytes = 256 bits of CSPRNG output, hex-encoded. This raw value is returned to the
// client EXACTLY ONCE (at sign-in or rotation) and is never recoverable afterwards —
// only its hash is stored.
export const generateRefreshToken = (): string => crypto.randomBytes(32).toString("hex");

// Hash a refresh token for storage/lookup.
//
// SHA-256 (not bcrypt) is the right primitive here. Password hashes are slow to defeat
// brute force over a small, guessable input space; a 256-bit random token has no such
// space to search. What we need instead is a deterministic, fast, indexable digest.
export const hashRefreshToken = (token: string): string =>
  crypto.createHash("sha256").update(token).digest("hex");

// Expiry instant for a newly issued refresh token.
export const refreshTokenExpiry = (): Date =>
  new Date(Date.now() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
