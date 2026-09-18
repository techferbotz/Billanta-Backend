// Pure constants for the invoice module — no Prisma, no env, no side effects, so anything
// may import them (the controller that enforces them, and the remote config document that
// mirrors them for the client).

// How many invoices one POST /invoices/sync push may carry. An offline device that has been
// away for weeks must chunk its backlog; the cap bounds the work of a single transaction and
// the size of the request body (which express.json also caps, at 2 MB).
//
// Mirrored to the app as `limits.maxSyncBatchInvoices` in the remote config, so the client
// chunks to the same number the server enforces. Change it HERE and both follow.
export const MAX_SYNC_BATCH_INVOICES = 500;
