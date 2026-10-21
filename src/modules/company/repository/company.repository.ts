import { Company, Prisma } from "@prisma/client";
import { prisma } from "../../../prisma/client";
import { serializable } from "../../../prisma/serializable";
import { Values, mergeValues, storedValues } from "../../../fields/values";

// All Company database access. No Prisma outside this file.
export class CompanyRepository {
  // The user's single company (V1: one per user), or null if they haven't set one up.
  async findByUserId(userId: string): Promise<Company | null> {
    return prisma.company.findUnique({ where: { userId } });
  }

  /**
   * Create or fully replace the user's company.
   *
   * Keyed on `userId` (unique), so this is genuinely idempotent: PUT-ing twice leaves one row,
   * and both branches write the whole map, which is what makes PUT a true full-replace.
   */
  async upsert(userId: string, values: Values): Promise<Company> {
    const json = values as Prisma.InputJsonObject;
    return prisma.company.upsert({
      where: { userId },
      create: { userId, values: json },
      update: { values: json },
    });
  }

  /**
   * Merge a patch into the user's company, creating it when there's none yet (an invoice can
   * write a company field back before the profile screen was ever opened). A serializable
   * read-modify-write, so two concurrent patches can't drop each other's keys.
   */
  async patch(userId: string, patch: Values): Promise<Company> {
    return serializable(async (tx) => {
      const existing = await tx.company.findUnique({ where: { userId } });
      const merged = mergeValues(storedValues(existing?.values), patch) as Prisma.InputJsonObject;
      return existing
        ? tx.company.update({ where: { userId }, data: { values: merged } })
        : tx.company.create({ data: { userId, values: merged } });
    });
  }
}

export const companyRepository = new CompanyRepository();
