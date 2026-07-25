import { Company } from "@prisma/client";
import { prisma } from "../../../prisma/client";
import { CompanyWriteData } from "../dto/company.dto";

// All Company database access. No Prisma outside this file.
export class CompanyRepository {
  // The user's single company (V1: one per user), or null if they haven't set one up.
  async findByUserId(userId: string): Promise<Company | null> {
    return prisma.company.findUnique({ where: { userId } });
  }

  /**
   * Create or fully replace the user's company.
   *
   * Keyed on `userId` (unique), so this is genuinely idempotent: PUT-ing twice leaves one
   * row. The `create` and `update` branches carry the SAME field set, which is what makes
   * PUT a true full-replace rather than a partial merge.
   */
  async upsert(userId: string, data: CompanyWriteData): Promise<Company> {
    return prisma.company.upsert({
      where: { userId },
      create: { userId, ...data },
      update: { ...data },
    });
  }
}

export const companyRepository = new CompanyRepository();
