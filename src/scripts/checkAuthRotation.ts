/**
 * Verifies the refresh-token state machine in auth.service.ts — rotation, reuse/theft
 * detection, expiry and logout — WITHOUT a database.
 *
 * Run: npx ts-node src/scripts/checkAuthRotation.ts
 *
 * The repositories are swapped for in-memory stubs that mirror the real Prisma semantics
 * (including `rotate` being atomic and `revokeAllForUser` touching only live rows). What
 * is under test is the service's decision logic, which is the part that must never
 * regress: a bug here is a session-hijack, and it is the one piece of Phase 2 that plain
 * endpoint smoke-testing cannot reach.
 *
 * Lives under src/ so `tsc --noEmit` type-checks it alongside the code it exercises.
 */
import { RefreshToken, User } from "@prisma/client";
import { authService, REFRESH_TOKEN_REUSED } from "../modules/auth/service/auth.service";
import {
  refreshTokenRepository,
  NewRefreshToken,
} from "../modules/auth/repository/refreshToken.repository";
import { userRepository } from "../modules/user/repository/user.repository";
import { AppError } from "../common/errors/AppError";
import { hashRefreshToken } from "../common/utils/jwt";

// --- tiny assertion harness --------------------------------------------------------
let passed = 0;
let failed = 0;

const check = (label: string, condition: boolean, detail = ""): void => {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

// Run a call that must reject, and hand the error back for inspection.
const expectReject = async (fn: () => Promise<unknown>): Promise<AppError | null> => {
  try {
    await fn();
    return null;
  } catch (err) {
    return err instanceof AppError ? err : null;
  }
};

// --- in-memory stand-ins for the Prisma-backed repositories -------------------------
const USER: User = {
  id: "user-1",
  googleId: "google-sub-1",
  email: "test@example.com",
  name: "Test User",
  photoUrl: null,
  isPremium: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const tokens = new Map<string, RefreshToken>(); // id -> row
let seq = 0;

const rowFor = (data: NewRefreshToken): RefreshToken => ({
  id: `token-${++seq}`,
  userId: data.userId,
  tokenHash: data.tokenHash,
  expiresAt: data.expiresAt,
  revokedAt: null,
  replacedById: null,
  userAgent: data.userAgent,
  createdAt: new Date(),
  updatedAt: new Date(),
});

refreshTokenRepository.create = async (data) => {
  const row = rowFor(data);
  tokens.set(row.id, row);
  return row;
};

refreshTokenRepository.findByHash = async (tokenHash) =>
  [...tokens.values()].find((t) => t.tokenHash === tokenHash) ?? null;

refreshTokenRepository.rotate = async (currentId, next) => {
  const created = rowFor(next);
  tokens.set(created.id, created);
  const current = tokens.get(currentId);
  if (current) {
    // Mirrors the real transaction: revoke the consumed token and link its successor.
    tokens.set(currentId, { ...current, revokedAt: new Date(), replacedById: created.id });
  }
  return created;
};

refreshTokenRepository.revokeById = async (id) => {
  const row = tokens.get(id);
  if (row && !row.revokedAt) tokens.set(id, { ...row, revokedAt: new Date() });
};

refreshTokenRepository.revokeAllForUser = async (userId) => {
  let count = 0;
  for (const [id, row] of tokens) {
    if (row.userId === userId && !row.revokedAt) {
      tokens.set(id, { ...row, revokedAt: new Date() });
      count++;
    }
  }
  return count;
};

userRepository.findById = async (id) => (id === USER.id ? USER : null);

// Seed a live refresh token directly, bypassing the Google sign-in path.
const seedToken = (raw: string, expiresAt = new Date(Date.now() + 60_000)): RefreshToken => {
  const row = rowFor({
    userId: USER.id,
    tokenHash: hashRefreshToken(raw),
    expiresAt,
    userAgent: "harness",
  });
  tokens.set(row.id, row);
  return row;
};

const isRevoked = (id: string): boolean => Boolean(tokens.get(id)?.revokedAt);

// --- the scenarios ------------------------------------------------------------------
const main = async (): Promise<void> => {
  console.log("\nrotation — a refresh consumes its token and issues a successor");
  const raw1 = "raw-token-one";
  const row1 = seedToken(raw1);
  const first = await authService.refresh(raw1, "harness");
  check("returns a NEW refresh token", first.refreshToken !== raw1);
  check("returns an access token", first.accessToken.split(".").length === 3);
  check("expiresIn is a positive number of seconds", first.expiresIn > 0);
  check("the consumed token is revoked", isRevoked(row1.id));
  check("the consumed token links to its successor", tokens.get(row1.id)?.replacedById !== null);
  check("the successor is live", !isRevoked(tokens.get(row1.id)!.replacedById!));

  console.log("\nreuse — replaying a consumed token is treated as theft");
  const liveBefore = [...tokens.values()].filter((t) => !t.revokedAt).length;
  check("exactly one live token before the replay", liveBefore === 1, `saw ${liveBefore}`);
  const reuse = await expectReject(() => authService.refresh(raw1, "attacker"));
  check("rejects", reuse !== null);
  check("with 401", reuse?.statusCode === 401, `saw ${reuse?.statusCode}`);
  check(`with code ${REFRESH_TOKEN_REUSED}`, reuse?.code === REFRESH_TOKEN_REUSED);
  const liveAfter = [...tokens.values()].filter((t) => !t.revokedAt).length;
  check("EVERY live token for the user is revoked", liveAfter === 0, `${liveAfter} still live`);

  console.log("\ncollateral — the honest client's fresh token died with the chain");
  const victim = await expectReject(() => authService.refresh(first.refreshToken, "honest"));
  check("the successor no longer works", victim?.statusCode === 401);

  console.log("\nexpiry — a stale but never-used token is refused");
  const rawExpired = "raw-token-expired";
  seedToken(rawExpired, new Date(Date.now() - 1000));
  const expired = await expectReject(() => authService.refresh(rawExpired, "harness"));
  check("rejects with 401", expired?.statusCode === 401);
  check("says 'expired', not 'revoked'", /expired/i.test(expired?.message ?? ""), expired?.message);
  check("does NOT report theft", expired?.code !== REFRESH_TOKEN_REUSED);

  console.log("\nunknown token — refused without leaking anything");
  const unknown = await expectReject(() => authService.refresh("never-issued", "harness"));
  check("rejects with 401", unknown?.statusCode === 401);

  console.log("\nlogout — revokes the presented token, silent about unknown ones");
  const raw2 = "raw-token-two";
  const row2 = seedToken(raw2);
  await authService.logout(raw2);
  check("the token is revoked", isRevoked(row2.id));
  let threw = false;
  try {
    await authService.logout("never-issued");
    await authService.logout(raw2); // already revoked — must stay idempotent
  } catch {
    threw = true;
  }
  check("unknown and repeated logouts do not throw", !threw);

  console.log("\nstorage — the raw token is never persisted");
  const rawsInStore = [...tokens.values()].filter((t) =>
    [raw1, raw2, first.refreshToken].includes(t.tokenHash)
  );
  check("no row stores a raw token value", rawsInStore.length === 0);
  check(
    "every stored hash is 64 hex chars (sha256)",
    [...tokens.values()].every((t) => /^[0-9a-f]{64}$/.test(t.tokenHash))
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
};

void main();
