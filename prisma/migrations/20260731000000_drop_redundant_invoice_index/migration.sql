-- Drop the redundant non-unique index on (userId, invoiceNumber): the
-- @@unique([userId, invoiceNumber]) already creates a btree index on exactly those columns,
-- so this second index only added write/storage cost with no read benefit.
DROP INDEX IF EXISTS "Invoice_userId_invoiceNumber_idx";
