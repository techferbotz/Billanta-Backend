import { BadRequestError } from "../../common/errors/AppError";

// The sync pull cursor. It is a KEYSET position — the (updatedAt, id) of the last row the
// client has already received — NOT a wall-clock time. This is deliberate:
//   - updatedAt is client-controlled device time, so a cursor derived from server now() would
//     compare across two clocks and silently drop rows (data loss). Keying the cursor off the
//     data's own updatedAt keeps the cursor and the pull filter in one clock domain.
//   - Pairing updatedAt with id makes the position total, so rows sharing an updatedAt are never
//     split across a page boundary and lost.
//
// It is opaque to the client: the server issues `nextCursor`, the client passes it back as
// `since`. First sync sends null.
export interface SyncCursor {
  updatedAt: Date;
  id: string;
}

export const encodeSyncCursor = (c: SyncCursor): string =>
  Buffer.from(`${c.updatedAt.toISOString()}|${c.id}`).toString("base64url");

// Decode a cursor the server previously issued. A malformed cursor is a 400, not a 500.
export const decodeSyncCursor = (raw: unknown): SyncCursor | null => {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") throw new BadRequestError('"since" must be a cursor string');
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  const sep = decoded.indexOf("|");
  if (sep === -1) throw new BadRequestError('"since" is not a valid cursor');
  const updatedAt = new Date(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (Number.isNaN(updatedAt.getTime()) || id.length === 0) {
    throw new BadRequestError('"since" is not a valid cursor');
  }
  return { updatedAt, id };
};
