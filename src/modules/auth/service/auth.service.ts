import { User } from "@prisma/client";
import { verifyGoogleIdToken, VerifiedGoogleProfile } from "../../../auth/googleVerifier";
import { userRepository } from "../../user/repository/user.repository";
import { refreshTokenRepository } from "../repository/refreshToken.repository";
import { UnauthorizedError } from "../../../common/errors/AppError";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  generateAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
} from "../../../common/utils/jwt";
import { AuthResponse, AuthUserDto } from "../dto/auth.dto";

// Machine-readable code returned when refresh-token reuse is detected, so the client can
// tell "your session was revoked, sign in again" apart from an ordinary expiry.
export const REFRESH_TOKEN_REUSED = "REFRESH_TOKEN_REUSED";

const toAuthUser = (user: User): AuthUserDto => ({
  id: user.id,
  email: user.email,
  name: user.name,
  photoUrl: user.photoUrl,
  isPremium: user.isPremium,
});

export class AuthService {
  /**
   * Sign in with a Google idToken.
   *
   * The idToken is verified against Google's signing keys FIRST — nothing in the request
   * body is trusted. Only after verification do we resolve it to an account.
   */
  async loginWithGoogle(idToken: string, userAgent: string | null): Promise<AuthResponse> {
    const profile = await verifyGoogleIdToken(idToken);
    const user = await this.findOrCreateUser(profile);
    return this.issueTokens(user, userAgent);
  }

  /**
   * Exchange a refresh token for a fresh pair, ROTATING the old one away.
   *
   * The interesting case is reuse. Because every successful refresh revokes the token it
   * consumed, a *revoked* token being presented means the raw value exists in two places:
   * the legitimate client and someone else. We cannot tell which one is talking to us, so
   * the only safe move is to revoke every live token for the user and force a fresh
   * sign-in. Legitimate clients lose a session; an attacker loses their foothold.
   */
  async refresh(rawToken: string, userAgent: string | null): Promise<AuthResponse> {
    const stored = await refreshTokenRepository.findByHash(hashRefreshToken(rawToken));

    // Unknown token: forged, or belonged to a deleted account (cascade removed the row).
    if (!stored) {
      throw new UnauthorizedError("Invalid refresh token");
    }

    // Already used or explicitly revoked -> treat as theft.
    if (stored.revokedAt) {
      const revoked = await refreshTokenRepository.revokeAllForUser(stored.userId);
      console.warn(
        `[auth] Refresh-token reuse detected for user ${stored.userId}; revoked ${revoked} live token(s).`
      );
      throw new UnauthorizedError(
        "This session has been revoked. Please sign in again.",
        REFRESH_TOKEN_REUSED
      );
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedError("Refresh token has expired");
    }

    const user = await userRepository.findById(stored.userId);
    if (!user) {
      // Defensive: the cascade should have removed this row with the account.
      throw new UnauthorizedError("Invalid refresh token");
    }

    const rawNext = generateRefreshToken();
    await refreshTokenRepository.rotate(stored.id, {
      userId: user.id,
      tokenHash: hashRefreshToken(rawNext),
      expiresAt: refreshTokenExpiry(),
      userAgent,
    });

    return {
      accessToken: generateAccessToken(user.id),
      refreshToken: rawNext,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user: toAuthUser(user),
    };
  }

  /**
   * Revoke the presented refresh token.
   *
   * Deliberately silent about whether the token existed: logout always reports success.
   * Reporting "unknown token" would turn this into an oracle for probing which stolen
   * values are live, and there is nothing a client could usefully do with the distinction.
   */
  async logout(rawToken: string): Promise<void> {
    const stored = await refreshTokenRepository.findByHash(hashRefreshToken(rawToken));
    if (stored) {
      await refreshTokenRepository.revokeById(stored.id);
    }
  }

  // --- internals ------------------------------------------------------------------

  /**
   * Resolve a verified Google profile to an account.
   *
   * Match order is googleId, then verified email:
   *   - googleId (`sub`) is the stable identity — it survives the user changing the email
   *     on their Google account.
   *   - Falling back to email links an existing account whose `sub` we somehow don't have.
   *     This is only safe because the verifier rejects tokens without `email_verified`.
   *
   * Profile fields are set at CREATION only, never refreshed on subsequent logins —
   * otherwise every sign-in would silently undo a user's own `PATCH /users/me` edits.
   */
  private async findOrCreateUser(profile: VerifiedGoogleProfile): Promise<User> {
    const byGoogleId = await userRepository.findByGoogleId(profile.googleId);
    if (byGoogleId) return byGoogleId;

    const byEmail = await userRepository.findByEmail(profile.email);
    if (byEmail) return userRepository.linkGoogleId(byEmail.id, profile.googleId);

    return userRepository.create({
      googleId: profile.googleId,
      email: profile.email,
      name: profile.name,
      photoUrl: profile.photoUrl,
    });
  }

  // Mint a fresh access + refresh pair for an authenticated user.
  private async issueTokens(user: User, userAgent: string | null): Promise<AuthResponse> {
    const rawRefresh = generateRefreshToken();
    await refreshTokenRepository.create({
      userId: user.id,
      tokenHash: hashRefreshToken(rawRefresh),
      expiresAt: refreshTokenExpiry(),
      userAgent,
    });

    return {
      accessToken: generateAccessToken(user.id),
      refreshToken: rawRefresh,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user: toAuthUser(user),
    };
  }
}

export const authService = new AuthService();
