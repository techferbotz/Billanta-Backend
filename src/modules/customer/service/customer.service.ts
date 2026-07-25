import { customerRepository } from "../repository/customer.repository";
import { PageParams, PaginatedResult } from "../../../common/pagination";
import { NotFoundError } from "../../../common/errors/AppError";
import { reconcileStateCode } from "../../../common/gstin";
import {
  CustomerDto,
  CustomerPatchData,
  CustomerWriteData,
  toCustomerDto,
} from "../dto/customer.dto";

export class CustomerService {
  /**
   * Create a customer.
   *
   * With a client-supplied id the write is idempotent: re-POSTing the same id replaces the
   * user's own row (the offline-sync path, including concurrent retries). A create whose id
   * belongs to ANOTHER user is rejected with 409 by the repository — the foreign row is
   * never touched and its contents never leak. All of that collision handling lives in the
   * repository, so no Prisma error type escapes into this layer.
   */
  async create(
    userId: string,
    id: string | undefined,
    data: CustomerWriteData
  ): Promise<CustomerDto> {
    const customer = id
      ? await customerRepository.createOrReplaceOwn(userId, id, data)
      : await customerRepository.createNew(userId, data);
    return toCustomerDto(customer);
  }

  async list(
    userId: string,
    page: PageParams,
    q?: string
  ): Promise<PaginatedResult<CustomerDto>> {
    const result = await customerRepository.listForUser(userId, page, q);
    return { ...result, items: result.items.map(toCustomerDto) };
  }

  async getById(userId: string, id: string): Promise<CustomerDto> {
    const customer = await customerRepository.findByIdForUser(id, userId);
    // 404 (not 403) for a missing OR foreign id — absence and "not yours" are
    // indistinguishable to the caller, so another user's ids can't be probed.
    if (!customer) throw new NotFoundError("Customer not found");
    return toCustomerDto(customer);
  }

  /**
   * Patch the user's own customer (partial merge).
   *
   * When the patch touches gstin or stateCode, the two must be reconciled against the
   * EFFECTIVE post-merge values — a PATCH that sets stateCode alone must not be allowed to
   * contradict a GSTIN already on the row. That needs the existing row, so we read it first
   * (which also gives the 404-for-foreign-or-missing check), reconcile, then write.
   */
  async patch(userId: string, id: string, data: CustomerPatchData): Promise<CustomerDto> {
    const touchesTax = "gstin" in data || "stateCode" in data;

    if (touchesTax) {
      const existing = await customerRepository.findByIdForUser(id, userId);
      if (!existing) throw new NotFoundError("Customer not found");

      const effectiveGstin = "gstin" in data ? data.gstin ?? null : existing.gstin;
      const effectiveStateCode = "stateCode" in data ? data.stateCode ?? null : existing.stateCode;
      // Throws BadRequestError if the two disagree; otherwise returns the value to store
      // (derived from the GSTIN when one is present).
      data.stateCode = reconcileStateCode(effectiveGstin, effectiveStateCode) ?? null;
    }

    const customer = await customerRepository.patchOwn(userId, id, data);
    if (!customer) throw new NotFoundError("Customer not found");
    return toCustomerDto(customer);
  }

  async delete(userId: string, id: string): Promise<void> {
    const deleted = await customerRepository.deleteOwn(userId, id);
    if (!deleted) throw new NotFoundError("Customer not found");
  }
}

export const customerService = new CustomerService();
