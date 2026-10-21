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

// A two-line invoice: 1×₹10 @18% + 2×₹20 @18%, 10% off before tax. The company and customer
// copies carry the same state (27), so the tax splits into CGST + SGST. `extra.values` merges
// into the values; any other key replaces the top-level one.
const invoicePayload = (
  id: string,
  number: string | null,
  extra: { values?: Record<string, unknown>; [key: string]: unknown } = {}
) => {
  const { values, ...rest } = extra;
  return {
    id,
    templateId: "classic",
    templateVersion: 1,
    values: {
      ...(number ? { invoice_number: number } : {}),
      invoice_date: "2026-07-25",
      company_name: "Acme",
      company_state: "27",
      customer_name: "Bob Buyer",
      customer_phone: "9876500000",
      customer_state: "27",
      discount: { kind: "percent", value: "10", beforeTax: true },
      ...values,
    },
    // Deliberately WRONG client totals — the server must ignore and correct these.
    computed: { subtotal: "999999", tax_total: "999999", grand_total: "999999" },
    lineItems: [
      { id: "bbbbbbbb-0000-4000-8000-000000000001", values: { description: "Widget", quantity: "1", unit_price: "1000", tax_rate: "18" } },
      { id: "bbbbbbbb-0000-4000-8000-000000000002", values: { description: "Gadget", quantity: "2", unit_price: "2000", tax_rate: "18" } },
    ],
    ...rest,
  };
};

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
    const t = data(c).computed;
    ok("server IGNORES wrong client totals and recomputes subtotal=5000", t.subtotal === "5000", t.subtotal);
    ok("server tax_total=810 (before-tax discount)", t.tax_total === "810", t.tax_total);
    ok("server discount_total=500", t.discount_total === "500", t.discount_total);
    ok("server grand_total=5310", t.grand_total === "5310", t.grand_total);
    ok("line tax_amounts recomputed (162, 648)",
      data(c).lineItems[0].computed.tax_amount === "162" && data(c).lineItems[1].computed.tax_amount === "648",
      JSON.stringify(data(c).lineItems.map((i: any) => i.computed)));
    ok("GST split intra-state -> CGST+SGST halves of 810", t.cgst_total === "405" && t.sgst_total === "405" && t.igst_total === "0");
    ok("line ids and values echo back exactly",
      data(c).lineItems[0].id === "bbbbbbbb-0000-4000-8000-000000000001" && data(c).lineItems[1].values.description === "Gadget");

    console.log("\nidempotent replace (no duplicate lines)");
    const again = await call(tA, "POST", "/invoices", invoicePayload(ID1, "INV-1", { values: { notes: "updated" } }));
    ok("re-POST same id -> 201 and replaces", again.status === 201 && data(again).values.notes === "updated");
    ok("re-POST keeps 2 lines (no orphans/dupes)", data(again).lineItems.length === 2);
    const dbItemCount = await prisma.invoiceItem.count({ where: { invoiceId: ID1 } });
    ok("DB has exactly 2 line rows", dbItemCount === 2, `found ${dbItemCount}`);

    console.log("\ninvoice numbers");
    const dupNum = await call(tA, "POST", "/invoices", invoicePayload("aaaaaaaa-0000-4000-8000-000000000002", "INV-1"));
    ok("different id + same invoice_number -> 409", dupNum.status === 409, JSON.stringify(dupNum.body));
    const draft1 = await call(tA, "POST", "/invoices", invoicePayload("aaaaaaaa-0000-4000-8000-000000000003", null));
    const draft2 = await call(tA, "POST", "/invoices", invoicePayload("aaaaaaaa-0000-4000-8000-000000000004", null));
    ok("two drafts with no number don't collide", draft1.status === 201 && draft2.status === 201, JSON.stringify(draft2.body));
    const renumber = await call(tA, "PATCH", "/invoices/aaaaaaaa-0000-4000-8000-000000000003", { values: { invoice_number: "INV-1" } });
    ok("PATCH to a number already used -> 409", renumber.status === 409);

    console.log("\nownership isolation (404 not 403)");
    ok("B GET A's invoice -> 404", (await call(tB, "GET", `/invoices/${ID1}`)).status === 404);
    ok("B PATCH A's invoice -> 404", (await call(tB, "PATCH", `/invoices/${ID1}`, { status: "Paid" })).status === 404);
    ok("B DELETE A's invoice -> 404", (await call(tB, "DELETE", `/invoices/${ID1}`)).status === 404);
    const bCollide = await call(tB, "POST", "/invoices", invoicePayload(ID1, "B-INV-1"));
    ok("B POST with A's id -> 409 (no overwrite)", bCollide.status === 409);
    const stillA = await call(tA, "GET", `/invoices/${ID1}`);
    ok("A's invoice untouched by B", data(stillA).values.invoice_number === "INV-1" && data(stillA).values.notes === "updated");
    ok("B list empty", data(await call(tB, "GET", "/invoices")).items.length === 0);

    console.log("\nsearch + patch + soft delete");
    ok("search by invoice number", data(await call(tA, "GET", "/invoices?q=INV-1")).items.length === 1);
    ok("search by the customer name copy", data(await call(tA, "GET", "/invoices?q=bob")).items.some((i: any) => i.id === ID1));
    const paid = await call(tA, "PATCH", `/invoices/${ID1}`, { status: "Paid" });
    ok("PATCH status -> Paid (totals unchanged)", data(paid).status === "Paid" && data(paid).computed.grand_total === "5310");
    ok("filter by status=Paid finds it", data(await call(tA, "GET", "/invoices?status=Paid")).items.length === 1);
    const noDiscount = await call(tA, "PATCH", `/invoices/${ID1}`, { values: { discount: null } });
    ok("PATCH values recomputes: clearing the discount -> 5000 + 900 = 5900",
      data(noDiscount).computed.grand_total === "5900" && !("discount" in data(noDiscount).values) && data(noDiscount).values.notes === "updated",
      JSON.stringify(data(noDiscount).computed));
    const interState = await call(tA, "PATCH", `/invoices/${ID1}`, { values: { customer_state: "29" } });
    ok("a customer in another state -> IGST", data(interState).computed.igst_total === "900" && data(interState).computed.cgst_total === "0");
    const del = await call(tA, "DELETE", `/invoices/${ID1}`);
    ok("soft delete -> 200", del.status === 200);
    ok("re-DELETE is idempotent -> 200 (not 404)", (await call(tA, "DELETE", `/invoices/${ID1}`)).status === 200);
    ok("deleted invoice -> 404 on GET", (await call(tA, "GET", `/invoices/${ID1}`)).status === 404);
    ok("deleted invoice excluded from list", data(await call(tA, "GET", "/invoices")).items.every((i: any) => i.id !== ID1));
    const reuse = await call(tA, "POST", "/invoices", invoicePayload("aaaaaaaa-0000-4000-8000-000000000005", "INV-1"));
    ok("a deleted invoice releases its number", reuse.status === 201, JSON.stringify(reuse.body));

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
      invoices: [invoicePayload(ID2, "SYNC-1", { updatedAt: older, values: { notes: "stale-should-be-ignored" } })],
      since: cursor1,
    });
    const afterStale = await call(tA, "GET", `/invoices/${ID2}`);
    ok("LWW: older push is skipped (notes not overwritten)", data(afterStale).values.notes !== "stale-should-be-ignored");
    // Push a NEWER version -> applied.
    await call(tA, "POST", "/invoices/sync", {
      invoices: [invoicePayload(ID2, "SYNC-1", { updatedAt: newer, values: { notes: "fresh", po_number: "PO-9" } })],
      since: cursor1,
    });
    const fresh = data(await call(tA, "GET", `/invoices/${ID2}`));
    ok("LWW: newer push is applied, every value with it", fresh.values.notes === "fresh" && fresh.values.po_number === "PO-9");
    // Cross-user id in a sync batch -> reported as a conflict, not applied, batch not aborted.
    const s2 = await call(tB, "POST", "/invoices/sync", {
      invoices: [invoicePayload(ID2, "B-SYNC", { updatedAt: newer })],
      since: null,
    });
    ok("cross-user id in sync -> reported conflict", data(s2).conflicts.some((c: any) => c.id === ID2));
    ok("A's invoice unaffected by B's sync", data(await call(tA, "GET", `/invoices/${ID2}`)).values.invoice_number === "SYNC-1");
    // A malformed money input in a batch is a per-item conflict too.
    const BAD = "aaaaaaaa-0000-4000-8000-000000000011";
    const s2b = await call(tA, "POST", "/invoices/sync", {
      invoices: [invoicePayload(BAD, "BAD-1", { updatedAt: newer, lineItems: [{ values: { unit_price: "12.50" } }] })],
      since: null,
    });
    ok("a malformed money input -> reported conflict, not applied",
      data(s2b).conflicts.some((c: any) => c.id === BAD) && (await call(tA, "GET", `/invoices/${BAD}`)).status === 404);
    // Tombstone propagation: the earlier soft-deleted ID1 appears in a full pull.
    const fullPull = await call(tA, "POST", "/invoices/sync", { invoices: [], since: null });
    ok("tombstone (deleted ID1) is in the sync pull", data(fullPull).changed.some((i: any) => i.id === ID1 && i.deletedAt !== null));

    console.log("\nreview-fix regressions (completion review)");
    // (1) A pathological (overflowing) invoice must NOT abort the batch — it's a per-item conflict,
    //     and the valid invoice alongside it still applies.
    const OVER = "aaaaaaaa-0000-4000-8000-000000000020";
    const GOOD = "aaaaaaaa-0000-4000-8000-000000000021";
    const overflowItems = [{ values: { description: "huge", quantity: "10000000000000000", unit_price: "1", tax_rate: "0" } }];
    const s3 = await call(tA, "POST", "/invoices/sync", {
      invoices: [
        invoicePayload(OVER, "OVR-1", { updatedAt: new Date().toISOString(), lineItems: overflowItems }),
        invoicePayload(GOOD, "GOOD-1", { updatedAt: new Date().toISOString() }),
      ],
      since: null,
    });
    ok("overflow invoice -> per-item conflict (batch NOT aborted, HTTP 200)", s3.status === 200 && data(s3).conflicts.some((c: any) => c.id === OVER));
    ok("valid invoice in same batch still applied", (await call(tA, "GET", `/invoices/${GOOD}`)).status === 200);

    // (2) PATCH { status: null } must NOT downgrade a Paid invoice to Draft.
    await call(tA, "PATCH", `/invoices/${GOOD}`, { status: "Paid" });
    const afterNull = await call(tA, "PATCH", `/invoices/${GOOD}`, { status: null, values: { notes: "paid via upi" } });
    ok("PATCH status:null leaves status unchanged (still Paid, not Draft)", data(afterNull).status === "Paid" && data(afterNull).values.notes === "paid via upi");

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
