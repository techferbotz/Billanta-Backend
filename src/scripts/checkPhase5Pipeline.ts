/**
 * End-to-end Phase 5 verification: invoice CRUD, server-side recompute, ownership isolation,
 * and offline sync (LWW + tombstones). Requires a reachable Postgres (DATABASE_URL) and the dev
 * server running.
 *   npm run dev            (one shell)
 *   npm run check:phase5   (another)
 */
import { prisma } from "../prisma/client";
import { config } from "../config/env";
import { generateAccessToken } from "../common/utils/jwt";

const BASE = `http://localhost:${config.port}`;

let passed = 0;
let failed = 0;
const ok = (label: string, cond: boolean, detail = ""): void => {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};

const call = async (
  token: string | null, method: string, path: string, body?: unknown
): Promise<{ status: number; body: any }> => {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const data = (r: { body: any }): any => r.body.data;

// A two-line invoice: 1×₹10 @18% + 2×₹20 @18%. Snapshots carry state codes (same -> CGST/SGST).
const invoicePayload = (id: string, number: string, extra: Record<string, unknown> = {}) => ({
  id,
  invoiceNumber: number,
  invoiceDate: "2026-07-25T00:00:00.000Z",
  templateId: "classic",
  templateVersion: 1,
  companySnapshot: { name: "Acme", stateCode: "27" },
  customerSnapshot: { name: "Bob Buyer", phone: "9876500000", stateCode: "27" },
  discountType: "Percentage",
  discountValue: "10",
  discountBeforeTax: true,
  // Deliberately WRONG client totals — the server must ignore and correct these.
  subtotal: "999999",
  taxTotal: "999999",
  grandTotal: "999999",
  items: [
    { description: "Widget", quantity: "1", unitPrice: "1000", taxRatePercent: "18" },
    { description: "Gadget", quantity: "2", unitPrice: "2000", taxRatePercent: "18" },
  ],
  ...extra,
});

const main = async (): Promise<void> => {
  try { await fetch(`${BASE}/`); }
  catch { console.error(`\nServer not reachable at ${BASE}. Start it with \`npm run dev\`.\n`); process.exit(2); }

  const suffix = Date.now();
  const A = await prisma.user.create({ data: { googleId: `g-A-${suffix}`, email: `a-${suffix}@t.local`, name: "A" } });
  const B = await prisma.user.create({ data: { googleId: `g-B-${suffix}`, email: `b-${suffix}@t.local`, name: "B" } });
  const tA = generateAccessToken(A.id);
  const tB = generateAccessToken(B.id);
  const ID1 = "aaaaaaaa-0000-4000-8000-000000000001";

  try {
    console.log("\ncreate + server-side recompute");
    const c = await call(tA, "POST", "/invoices", invoicePayload(ID1, "INV-1"));
    ok("create -> 201", c.status === 201);
    // Expected (before-tax 10%): lines 1000 & 4000 (subtotal 5000); disc 500 -> 100/400 apportion;
    // taxable 900 & 3600 @18% -> 162 & 648 -> taxTotal 810; grand 5000-500+810 = 5310.
    ok("server IGNORES wrong client totals and recomputes subtotal=5000", data(c).subtotal === "5000", data(c).subtotal);
    ok("server taxTotal=810 (before-tax discount)", data(c).taxTotal === "810", data(c).taxTotal);
    ok("server discountTotal=500", data(c).discountTotal === "500", data(c).discountTotal);
    ok("server grandTotal=5310", data(c).grandTotal === "5310", data(c).grandTotal);
    ok("line taxAmounts recomputed (162, 648)", data(c).items[0].taxAmount === "162" && data(c).items[1].taxAmount === "648", JSON.stringify(data(c).items.map((i: any) => i.taxAmount)));
    ok("GST split intra-state -> CGST+SGST halves of 810", data(c).gstSplit.intraState === true && data(c).gstSplit.cgst === "405" && data(c).gstSplit.sgst === "405");

    console.log("\nidempotent replace (no duplicate items)");
    const again = await call(tA, "POST", "/invoices", invoicePayload(ID1, "INV-1", { notes: "updated" }));
    ok("re-POST same id -> 201 and replaces", again.status === 201 && data(again).notes === "updated");
    ok("re-POST keeps 2 items (no orphans/dupes)", data(again).items.length === 2);
    const dbItemCount = await prisma.invoiceItem.count({ where: { invoiceId: ID1 } });
    ok("DB has exactly 2 item rows", dbItemCount === 2, `found ${dbItemCount}`);

    console.log("\nduplicate invoice number");
    const dupNum = await call(tA, "POST", "/invoices", invoicePayload("aaaaaaaa-0000-4000-8000-000000000002", "INV-1"));
    ok("different id + same invoiceNumber -> 409", dupNum.status === 409, JSON.stringify(dupNum.body));

    console.log("\nownership isolation (404 not 403)");
    ok("B GET A's invoice -> 404", (await call(tB, "GET", `/invoices/${ID1}`)).status === 404);
    ok("B PATCH A's invoice -> 404", (await call(tB, "PATCH", `/invoices/${ID1}`, { status: "Paid" })).status === 404);
    ok("B DELETE A's invoice -> 404", (await call(tB, "DELETE", `/invoices/${ID1}`)).status === 404);
    const bCollide = await call(tB, "POST", "/invoices", invoicePayload(ID1, "B-INV-1"));
    ok("B POST with A's id -> 409 (no overwrite)", bCollide.status === 409);
    const stillA = await call(tA, "GET", `/invoices/${ID1}`);
    ok("A's invoice untouched by B", data(stillA).invoiceNumber === "INV-1" && data(stillA).notes === "updated");
    ok("B list empty", data(await call(tB, "GET", "/invoices")).items.length === 0);

    console.log("\nsearch + patch + soft delete");
    ok("search by invoice number", data(await call(tA, "GET", "/invoices?q=INV-1")).items.length === 1);
    ok("search by snapshot customer name", data(await call(tA, "GET", "/invoices?q=Bob")).items.some((i: any) => i.id === ID1));
    const paid = await call(tA, "PATCH", `/invoices/${ID1}`, { status: "Paid" });
    ok("PATCH status -> Paid (totals unchanged)", data(paid).status === "Paid" && data(paid).grandTotal === "5310");
    ok("filter by status=Paid finds it", data(await call(tA, "GET", "/invoices?status=Paid")).items.length === 1);
    const del = await call(tA, "DELETE", `/invoices/${ID1}`);
    ok("soft delete -> 200", del.status === 200);
    ok("re-DELETE is idempotent -> 200 (not 404)", (await call(tA, "DELETE", `/invoices/${ID1}`)).status === 200);
    ok("deleted invoice -> 404 on GET", (await call(tA, "GET", `/invoices/${ID1}`)).status === 404);
    ok("deleted invoice excluded from list", data(await call(tA, "GET", "/invoices")).items.every((i: any) => i.id !== ID1));

    console.log("\nsync: LWW + tombstones + conflicts");
    const ID2 = "aaaaaaaa-0000-4000-8000-000000000010";
    const now = new Date();
    const older = new Date(now.getTime() - 60000).toISOString();
    const newer = new Date(now.getTime() + 60000).toISOString();
    // First create ID2 via sync with a mid timestamp.
    const s1 = await call(tA, "POST", "/invoices/sync", {
      invoices: [invoicePayload(ID2, "SYNC-1", { updatedAt: now.toISOString() })],
      since: null,
    });
    ok("sync push creates + returns it in changed", data(s1).changed.some((i: any) => i.id === ID2));
    ok("sync returns an opaque nextCursor + hasMore", typeof data(s1).nextCursor === "string" && typeof data(s1).hasMore === "boolean");
    const cursor1 = data(s1).nextCursor;
    // Push an OLDER version of ID2 -> LWW should skip it (server keeps the newer). since = cursor.
    await call(tA, "POST", "/invoices/sync", {
      invoices: [invoicePayload(ID2, "SYNC-1", { updatedAt: older, notes: "stale-should-be-ignored" })],
      since: cursor1,
    });
    const afterStale = await call(tA, "GET", `/invoices/${ID2}`);
    ok("LWW: older push is skipped (notes not overwritten)", data(afterStale).notes !== "stale-should-be-ignored");
    // Push a NEWER version -> applied.
    await call(tA, "POST", "/invoices/sync", {
      invoices: [invoicePayload(ID2, "SYNC-1", { updatedAt: newer, notes: "fresh" })],
      since: cursor1,
    });
    ok("LWW: newer push is applied", data(await call(tA, "GET", `/invoices/${ID2}`)).notes === "fresh");
    // Cross-user id in a sync batch -> reported as a conflict, not applied, batch not aborted.
    const s2 = await call(tB, "POST", "/invoices/sync", {
      invoices: [invoicePayload(ID2, "B-SYNC", { updatedAt: newer })],
      since: null,
    });
    ok("cross-user id in sync -> reported conflict", data(s2).conflicts.some((c: any) => c.id === ID2));
    ok("A's invoice unaffected by B's sync", data(await call(tA, "GET", `/invoices/${ID2}`)).invoiceNumber === "SYNC-1");
    // Tombstone propagation: the earlier soft-deleted ID1 appears in a full pull.
    const fullPull = await call(tA, "POST", "/invoices/sync", { invoices: [], since: null });
    ok("tombstone (deleted ID1) is in the sync pull", data(fullPull).changed.some((i: any) => i.id === ID1 && i.deletedAt !== null));

    console.log("\nreview-fix regressions (completion review)");
    // (1) A pathological (overflowing) invoice must NOT abort the batch — it's a per-item conflict,
    //     and the valid invoice alongside it still applies.
    const OVER = "aaaaaaaa-0000-4000-8000-000000000020";
    const GOOD = "aaaaaaaa-0000-4000-8000-000000000021";
    const overflowItems = [{ description: "huge", quantity: "10000000000000000", unitPrice: "1", taxRatePercent: "0" }];
    const s3 = await call(tA, "POST", "/invoices/sync", {
      invoices: [
        invoicePayload(OVER, "OVR-1", { updatedAt: new Date().toISOString(), items: overflowItems }),
        invoicePayload(GOOD, "GOOD-1", { updatedAt: new Date().toISOString() }),
      ],
      since: null,
    });
    ok("overflow invoice -> per-item conflict (batch NOT aborted, HTTP 200)", s3.status === 200 && data(s3).conflicts.some((c: any) => c.id === OVER));
    ok("valid invoice in same batch still applied", (await call(tA, "GET", `/invoices/${GOOD}`)).status === 200);

    // (2) PATCH { status: null } must NOT downgrade a Paid invoice to Draft.
    await call(tA, "PATCH", `/invoices/${GOOD}`, { status: "Paid" });
    const afterNull = await call(tA, "PATCH", `/invoices/${GOOD}`, { status: null, notes: "paid via upi" });
    ok("PATCH status:null leaves status unchanged (still Paid, not Draft)", data(afterNull).status === "Paid" && data(afterNull).notes === "paid via upi");

    // (3) DELETE stamps the tombstone with a MONOTONIC updatedAt (never below the row's current
    //     value), even when the client sends an older delete time.
    const beforeDel = data(await call(tA, "GET", `/invoices/${GOOD}`));
    await call(tA, "DELETE", `/invoices/${GOOD}`, { updatedAt: older }); // older < the row's updatedAt
    const delPull = await call(tA, "POST", "/invoices/sync", { invoices: [], since: null });
    const goodTomb = data(delPull).changed.find((i: any) => i.id === GOOD);
    ok("delete tombstone present with deletedAt", goodTomb && goodTomb.deletedAt !== null);
    ok("tombstone updatedAt is monotonic (>= prior), not sunk to the older client time", goodTomb && new Date(goodTomb.updatedAt).getTime() >= new Date(beforeDel.updatedAt).getTime());

    // cleanup
    await prisma.user.deleteMany({ where: { id: { in: [A.id, B.id] } } });
    await prisma.$disconnect();
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    await prisma.user.deleteMany({ where: { id: { in: [A.id, B.id] } } }).catch(() => {});
    await prisma.$disconnect();
    throw err;
  }
};

main().catch((err) => { console.error(err); process.exit(1); });
