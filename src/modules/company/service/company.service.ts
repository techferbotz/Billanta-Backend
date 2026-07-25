import { companyRepository } from "../repository/company.repository";
import { CompanyDto, CompanyWriteData, toCompanyDto } from "../dto/company.dto";

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

  async put(userId: string, data: CompanyWriteData): Promise<CompanyDto> {
    const company = await companyRepository.upsert(userId, data);
    return toCompanyDto(company);
  }
}

export const companyService = new CompanyService();
