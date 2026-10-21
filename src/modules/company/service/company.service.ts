import { companyRepository } from "../repository/company.repository";
import { CompanyDto, toCompanyDto } from "../dto/company.dto";
import { Values } from "../../../fields/values";

export class CompanyService {
  /**
   * The user's company, or null when not yet set up.
   *
   * Company is a per-user SINGLETON whose absence is a normal first-run state, not a
   * lookup miss — so this returns null (the controller sends 200 with `data: null`) rather
   * than 404. Contrast with an addressed row like /customers/:id, where absence IS a miss
   * and returns 404.
   */
  async get(userId: string): Promise<CompanyDto | null> {
    const company = await companyRepository.findByUserId(userId);
    return company ? toCompanyDto(company) : null;
  }

  async put(userId: string, values: Values): Promise<CompanyDto> {
    return toCompanyDto(await companyRepository.upsert(userId, values));
  }

  async patch(userId: string, patch: Values): Promise<CompanyDto> {
    return toCompanyDto(await companyRepository.patch(userId, patch));
  }
}

export const companyService = new CompanyService();
