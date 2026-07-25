import { Settings, Prisma } from "@prisma/client";
import { prisma } from "../../../prisma/client";
import { SettingsWriteData } from "../dto/settings.dto";

// All Settings database access. No Prisma outside this file.
export class SettingsRepository {
  async findByUserId(userId: string): Promise<Settings | null> {
    return prisma.settings.findUnique({ where: { userId } });
  }

  /**
   * The user's settings, auto-creating a defaults row on first access.
   *
   * The create is race-safe: if two concurrent first-GETs both see null and both try to
   * create, the loser hits the P2002 unique violation and simply re-reads the winner's row.
   * Keeping this here (rather than in the service) is what keeps @prisma/client out of the
   * service layer. Column defaults (INR, nextInvoiceNumber 1) supply the values.
   */
  async getOrCreate(userId: string): Promise<Settings> {
    const existing = await prisma.settings.findUnique({ where: { userId } });
    if (existing) return existing;

    try {
      return await prisma.settings.create({ data: { userId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const row = await prisma.settings.findUnique({ where: { userId } });
        if (row) return row;
      }
      throw err;
    }
  }

  /**
   * Merge the given fields into the user's settings (PUT is a merge — see settings.dto.ts).
   *
   * `upsert` keyed on the unique `userId` is idempotent. Only the fields present in `data`
   * are written, so an omitted field is untouched on update; on the create branch, omitted
   * columns take their schema defaults (INR, nextInvoiceNumber 1) — so a first-ever PUT can
   * never produce a null counter that contradicts getOrCreate().
   */
  async upsertMerge(userId: string, data: SettingsWriteData): Promise<Settings> {
    return prisma.settings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: { ...data },
    });
  }
}

export const settingsRepository = new SettingsRepository();
