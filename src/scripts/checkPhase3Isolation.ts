/**
 * End-to-end Phase 3 verification, focused on CROSS-USER ISOLATION — the one property that
 * no-DB smoke tests cannot reach, because it lives in the repositories' userId-scoped
 * Prisma where-clauses.
 *
 * Requires BOTH a reachable Postgres (DATABASE_URL) and the dev server running on PORT.
 * Run:  npm run dev         (in one shell)
 *       npm run check:phase3 (in another)
 *
 * It seeds two throwaway users directly via Prisma, mints an access token for each (the
 * same tokens authMiddleware accepts), then drives the live HTTP API as user A and user B
 * to prove B can never see, edit, or delete A's data — and that A's client-supplied
 * customer ids are idempotent. Everything it creates is deleted at the end.
 */
import { prisma } from "../prisma/client";
import { generateAccessToken } from "../common/utils/jwt";
import { config } from "../config/env";

const BASE = `http://localhost:${config.port}`;

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

interface ApiResult {
  status: number;
  body: { success: boolean; data?: unknown; message?: string; code?: string };
}

const api = async (
  token: string | null,
  method: string,
  path: string,
  body?: unknown
): Promise<ApiResult> => {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as ApiResult["body"];
  return { status: res.status, body: json };
};

const data = (r: ApiResult): any => r.body.data;

const main = async (): Promise<void> => {
  // Fail early with a clear message if the server isn't up.
  try {
    await fetch(`${BASE}/`);
  } catch {
    console.error(`\nServer not reachable at ${BASE}. Start it with \`npm run dev\` first.\n`);
    process.exit(2);
  }

  const suffix = Date.now();
  const A = await prisma.user.create({
    data: { googleId: `g-A-${suffix}`, email: `a-${suffix}@test.local`, name: "User A" },
  });
  const B = await prisma.user.create({
    data: { googleId: `g-B-${suffix}`, email: `b-${suffix}@test.local`, name: "User B" },
  });
  const tokenA = generateAccessToken(A.id);
  const tokenB = generateAccessToken(B.id);

  try {
    console.log("\ncompany — singleton per user, isolated");
    check("A GET /company is null before setup", data(await api(tokenA, "GET", "/company")) === null);
    const putA = await api(tokenA, "PUT", "/company", {
      name: "Acme Traders",
      gstin: "27AAPFU0939F1ZV",
      addressLine1: "1 MG Road",
      city: "Pune",
    });
    check("A PUT /company succeeds", putA.status === 200 && data(putA).name === "Acme Traders");
    check("A PUT /company derives stateCode 27 from GSTIN", data(putA).stateCode === "27");
    check("B GET /company is still null (isolation)", data(await api(tokenB, "GET", "/company")) === null);
    // full-replace: omitting city clears it
    const putA2 = await api(tokenA, "PUT", "/company", { name: "Acme Traders" });
    check("A PUT /company full-replace nulls omitted city", data(putA2).city === null);

    console.log("\nsettings — auto-created, isolated");
    const sgA = await api(tokenA, "GET", "/settings");
    check("A GET /settings auto-creates with INR default", data(sgA).defaultCurrency === "INR");
    check("A settings nextInvoiceNumber defaults to 1", data(sgA).nextInvoiceNumber === 1);
    const sPut = await api(tokenA, "PUT", "/settings", { defaultCurrency: "USD", defaultTaxPercent: 18, nextInvoiceNumber: 5 });
    check("A PUT /settings stores decimal tax as exact string", data(sPut).defaultTaxPercent === "18");
    check("A PUT /settings currency updated", data(sPut).defaultCurrency === "USD");
    const sgB = await api(tokenB, "GET", "/settings");
    check("B settings independent of A (still INR)", data(sgB).defaultCurrency === "INR");

    console.log("\ncustomer — client uuid, idempotency, isolation, 404-not-403");
    const cid = "11111111-1111-4111-8111-111111111111";
    const c1 = await api(tokenA, "POST", "/customers", { id: cid, name: "Bob Buyer", phone: "9876543210" });
    check("A POST /customers with client uuid -> 201", c1.status === 201 && data(c1).id === cid);
    // idempotent replace
    const c2 = await api(tokenA, "POST", "/customers", { id: cid, name: "Bob Buyer Renamed", phone: "9876543210" });
    check("A re-POST same id updates, not duplicates", c2.status === 201 && data(c2).name === "Bob Buyer Renamed");
    const listA = await api(tokenA, "GET", "/customers");
    check("A list has exactly 1 customer (no duplicate)", data(listA).items.length === 1);

    // isolation: B cannot see/touch A's customer
    check("B GET A's customer -> 404", (await api(tokenB, "GET", `/customers/${cid}`)).status === 404);
    check("B PATCH A's customer -> 404", (await api(tokenB, "PATCH", `/customers/${cid}`, { name: "hax" })).status === 404);
    check("B DELETE A's customer -> 404", (await api(tokenB, "DELETE", `/customers/${cid}`)).status === 404);
    const collide = await api(tokenB, "POST", "/customers", { id: cid, name: "B tries A's id" });
    check("B POST with A's id -> 409 (no overwrite)", collide.status === 409);
    // prove A's row is untouched by B's attempts
    const stillA = await api(tokenA, "GET", `/customers/${cid}`);
    check("A's customer name unchanged after B's attempts", data(stillA).name === "Bob Buyer Renamed");
    check("B list is empty (never saw A's customer)", data(await api(tokenB, "GET", "/customers")).items.length === 0);

    console.log("\ncustomer — search + PATCH merge");
    await api(tokenA, "POST", "/customers", { name: "Charlie Corp", phone: "5550001111" });
    const search = await api(tokenA, "GET", "/customers?q=charlie");
    check("A search q=charlie finds Charlie", data(search).items.length === 1 && data(search).items[0].name === "Charlie Corp");
    const searchPhone = await api(tokenA, "GET", "/customers?q=98765");
    check("A search by phone fragment finds Bob", data(searchPhone).items.some((c: any) => c.id === cid));
    const patch = await api(tokenA, "PATCH", `/customers/${cid}`, { email: "bob@x.com" });
    check("A PATCH merges (email set, name preserved)", data(patch).email === "bob@x.com" && data(patch).name === "Bob Buyer Renamed");

    console.log("\naccount deletion cascades");
    const delA = await api(tokenA, "DELETE", "/users/me");
    check("A DELETE /users/me -> 200", delA.status === 200);
    const remaining = await prisma.customer.count({ where: { userId: A.id } });
    check("A's customers cascade-deleted with the account", remaining === 0);
    const companyGone = await prisma.company.count({ where: { userId: A.id } });
    check("A's company cascade-deleted", companyGone === 0);
  } finally {
    // Cleanup — B (and A if the deletion test didn't run).
    await prisma.user.deleteMany({ where: { id: { in: [A.id, B.id] } } });
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
};

void main();
