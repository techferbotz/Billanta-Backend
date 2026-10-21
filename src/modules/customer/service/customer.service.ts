import { customerRepository } from "../repository/customer.repository";
import { PageParams, PaginatedResult } from "../../../common/pagination";
import { NotFoundError } from "../../../common/errors/AppError";
import { Values } from "../../../fields/values";
import { CustomerDto, toCustomerDto } from "../dto/customer.dto";

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
  async create(userId: string, id: string | undefined, values: Values): Promise<CustomerDto> {
    const customer = id
      ? await customerRepository.createOrReplaceOwn(userId, id, values)
      : await customerRepository.createNew(userId, values);
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

  // Merge a patch into the user's own customer (404 for a missing or foreign id).
  async patch(userId: string, id: string, patch: Values): Promise<CustomerDto> {
    const customer = await customerRepository.patchOwn(userId, id, patch);
    if (!customer) throw new NotFoundError("Customer not found");
    return toCustomerDto(customer);
  }

  async delete(userId: string, id: string): Promise<void> {
    const deleted = await customerRepository.deleteOwn(userId, id);
    if (!deleted) throw new NotFoundError("Customer not found");
  }
}

export const customerService = new CustomerService();
