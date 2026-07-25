import { RefreshToken } from "@prisma/client";
import { prisma } from "../../../prisma/client";

// All RefreshToken database access. No Prisma outside this file.

export interface NewRefreshToken {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent: string | null;
}

export class RefreshTokenRepository {
  // Issue a brand-new token row (sign-in).
  async create(data: NewRefreshToken): Promise<RefreshToken> {
    return prisma.refreshToken.create({ data });
  }

  // Look a token up by its hash. The caller hashes the raw value first — the raw token
  // never reaches the database layer.
  async findByHash(tokenHash: string): Promise<RefreshToken | null> {
    return prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  /**
   * Atomically exchange one refresh token for its successor.
   *
   * Both writes must land together: creating the replacement without revoking the old one
   * would leave two live tokens (defeating rotation), and revoking without creating would
   * sign the user out mid-refresh. An interactive transaction is required rather than a
   * batch because the new row's id is only known after it is created.
   */
  async rotate(currentId: string, next: NewRefreshToken): Promise<RefreshToken> {
    return prisma.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({ data: next });
      await tx.refreshToken.update({
        where: { id: currentId },
        data: { revokedAt: new Date(), replacedById: created.id },
      });
      return created;
    });
  }

  // Revoke a single token (logout). Idempotent: `updateMany` matching only live tokens
  // means re-presenting an already-revoked token is a no-op rather than a P2025 error.
  async revokeById(id: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Revoke every live token for a user — the theft response, and also what account
   * deletion relies on implicitly via cascade.
   *
   * Returns how many were revoked, purely so the caller can log the blast radius.
   */
  async revokeAllForUser(userId: string): Promise<number> {
    const result = await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }
}

export const refreshTokenRepository = new RefreshTokenRepository();
