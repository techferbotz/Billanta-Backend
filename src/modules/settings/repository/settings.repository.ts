import { Settings, Prisma } from "@prisma/client";
import { prisma } from "../../../prisma/client";
import { serializable } from "../../../prisma/serializable";
import { Values, mergeValues, storedValues } from "../../../fields/values";

// All Settings database access. No Prisma outside this file.
export class SettingsRepository {
  /**
   * The user's settings, auto-creating a row with `defaults` on first access.
   *
   * The create is race-safe: if two concurrent first-GETs both see null and both try to
   * create, the loser hits the P2002 unique violation and simply re-reads the winner's row.
   * Keeping this here (rather than in the service) is what keeps @prisma/client out of the
   * service layer.
   */
  async getOrCreate(userId: string, defaults: Values): Promise<Settings> {
    const existing = await prisma.settings.findUnique({ where: { userId } });
    if (existing) return existing;

    try {
      return await prisma.settings.create({ data: { userId, values: defaults as Prisma.InputJsonObject } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const row = await prisma.settings.findUnique({ where: { userId } });
        if (row) return row;
      }
      throw err;
    }
  }

  // Create or fully replace the user's settings. Keyed on the unique `userId`, so idempotent.
  async upsert(userId: string, values: Values): Promise<Settings> {
    const json = values as Prisma.InputJsonObject;
    return prisma.settings.upsert({
      where: { userId },
      create: { userId, values: json },
      update: { values: json },
    });
  }

  /**
   * Merge a patch into the user's settings. A first-ever PATCH merges into `defaults`, so it can
   * never produce a row missing the running invoice number. Serializable, so two concurrent
   * patches can't drop each other's keys.
   */
  async patch(userId: string, patch: Values, defaults: Values): Promise<Settings> {
    return serializable(async (tx) => {
      const existing = await tx.settings.findUnique({ where: { userId } });
      const base = existing ? storedValues(existing.values) : defaults;
      const merged = mergeValues(base, patch) as Prisma.InputJsonObject;
      return existing
        ? tx.settings.update({ where: { userId }, data: { values: merged } })
        : tx.settings.create({ data: { userId, values: merged } });
    });
  }
}

export const settingsRepository = new SettingsRepository();
