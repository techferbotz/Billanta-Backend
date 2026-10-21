import { productRepository } from "../repository/product.repository";
import { PageParams, PaginatedResult } from "../../../common/pagination";
import { NotFoundError } from "../../../common/errors/AppError";
import { Values } from "../../../fields/values";
import { ProductDto, toProductDto } from "../dto/product.dto";

// Product business rules. Thin — just the ownership 404s; client-id idempotency is handled in the
// repository.
export class ProductService {
  /**
   * Create a product. With a client-supplied id the write is idempotent: re-POSTing the same id
   * replaces the user's own row (the offline replay path); an id owned by another user is a 409
   * from the repository, and that foreign row is never touched.
   */
  async create(userId: string, id: string | undefined, values: Values): Promise<ProductDto> {
    const product = id
      ? await productRepository.createOrReplaceOwn(userId, id, values)
      : await productRepository.createNew(userId, values);
    return toProductDto(product);
  }

  async list(userId: string, page: PageParams, q?: string): Promise<PaginatedResult<ProductDto>> {
    const result = await productRepository.listForUser(userId, page, q);
    return { ...result, items: result.items.map(toProductDto) };
  }

  async getById(userId: string, id: string): Promise<ProductDto> {
    const product = await productRepository.findByIdForUser(id, userId);
    // 404 (not 403) for a missing OR foreign id — absence and "not yours" are indistinguishable.
    if (!product) throw new NotFoundError("Product not found");
    return toProductDto(product);
  }

  async patch(userId: string, id: string, patch: Values): Promise<ProductDto> {
    const product = await productRepository.patchOwn(userId, id, patch);
    if (!product) throw new NotFoundError("Product not found");
    return toProductDto(product);
  }

  // Deletes the row only. The photo's S3 objects stay, like a replaced logo: one upload can back
  // several rows (a duplicated product, the same picture used as a logo, an invoice line it was
  // copied into) and nothing records who else points at it. They go with the account — the
  // deletion runbook clears media/<userId>/.
  async delete(userId: string, id: string): Promise<void> {
    const deleted = await productRepository.deleteOwn(userId, id);
    if (!deleted) throw new NotFoundError("Product not found");
  }
}

export const productService = new ProductService();
