import { Request } from "express";

// Cursor-based pagination, shared by every list endpoint (customers, invoices,
// templates). Cursor rather than offset because rows shift under an offset as the user
// keeps creating invoices on the device.
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface PageParams {
  limit: number;
  cursor?: string; // opaque: the id of the last item from the previous page
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null; // pass back as ?cursor for the next page; null = end
  hasMore: boolean;
}

// Read & sanitize ?limit / ?cursor from a request. `limit` is clamped to [1, MAX_PAGE_SIZE]
// so a client can't ask for the whole table.
export const parsePagination = (req: Request): PageParams => {
  const rawLimit = Number(req.query.limit);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  const rawCursor = req.query.cursor;
  const cursor = typeof rawCursor === "string" && rawCursor.length > 0 ? rawCursor : undefined;

  return { limit, cursor };
};

// Turn a `take: limit + 1` query result into a page. Fetching one extra row is how we
// know whether another page exists without a second COUNT query; the last KEPT row's id
// becomes the next cursor.
export const paginate = <T extends { id: string }>(
  rows: T[],
  limit: number
): PaginatedResult<T> => {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : null;
  return { items, nextCursor, hasMore };
};
