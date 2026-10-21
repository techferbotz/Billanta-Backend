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
    console.log("\nforms — public, cacheable");
    const forms = await api(null, "GET", "/forms");
    check("GET /forms works signed out and lists the four forms",
      forms.status === 200 && ["company", "customer", "product", "settings"].every((f) => f in data(forms).forms));
    const formsRes = await fetch(`${BASE}/forms`);
    const etag = formsRes.headers.get("etag");
    const revalidated = await fetch(`${BASE}/forms`, { headers: { "If-None-Match": etag ?? "" } });
    check("GET /forms revalidates to a 304 with its ETag", !!etag && revalidated.status === 304);

    console.log("\ncompany — singleton per user, isolated");
    check("A GET /company is null before setup", data(await api(tokenA, "GET", "/company")) === null);
    const putA = await api(tokenA, "PUT", "/company", {
      values: { company_name: "Acme Traders", company_gstin: "27AAPFU0939F1ZV", company_address_line1: "1 MG Road", company_city: "Pune" },
    });
    check("A PUT /company succeeds", putA.status === 200 && data(putA).values.company_name === "Acme Traders");
    check("B GET /company is still null (isolation)", data(await api(tokenB, "GET", "/company")) === null);
    // full-replace: omitting city clears it
    const putA2 = await api(tokenA, "PUT", "/company", { values: { company_name: "Acme Traders" } });
    check("A PUT /company full-replace drops the omitted city", !("company_city" in data(putA2).values));
    const patchA = await api(tokenA, "PATCH", "/company", { values: { company_city: "Mumbai" } });
    check("A PATCH /company merges (city set, name kept)",
      data(patchA).values.company_city === "Mumbai" && data(patchA).values.company_name === "Acme Traders");
    const patchB = await api(tokenB, "PATCH", "/company", { values: { company_bank_ifsc: "HDFC0001234" } });
    check("B PATCH /company creates B's own profile (an invoice can write back first)",
      patchB.status === 200 && JSON.stringify(data(patchB).values) === JSON.stringify({ company_bank_ifsc: "HDFC0001234" }));
    check("A PUT /company with a customer field -> 400",
      (await api(tokenA, "PUT", "/company", { values: { customer_name: "x" } })).status === 400);

    console.log("\nsettings — auto-created with the form's defaults, isolated");
    const sgA = await api(tokenA, "GET", "/settings");
    check("A GET /settings auto-creates with INR, INV- and counter 1",
      data(sgA).values.settings_default_currency === "INR" && data(sgA).values.settings_invoice_prefix === "INV-" &&
        data(sgA).values.settings_next_invoice_number === "1");
    const sPatch = await api(tokenA, "PATCH", "/settings", { values: { settings_default_currency: "USD", settings_default_tax_rate: "18", settings_next_invoice_number: "5" } });
    check("A PATCH /settings merges and keeps the prefix", data(sPatch).values.settings_default_tax_rate === "18" &&
      data(sPatch).values.settings_default_currency === "USD" && data(sPatch).values.settings_invoice_prefix === "INV-");
    const sgB = await api(tokenB, "GET", "/settings");
    check("B settings independent of A (still INR)", data(sgB).values.settings_default_currency === "INR");

    console.log("\ncustomer — client uuid, idempotency, isolation, 404-not-403");
    const cid = "11111111-1111-4111-8111-111111111111";
    const bob = (name: string) => ({ id: cid, values: { customer_name: name, customer_phone: "9876543210" } });
    const c1 = await api(tokenA, "POST", "/customers", bob("Bob Buyer"));
    check("A POST /customers with client uuid -> 201", c1.status === 201 && data(c1).id === cid);
    // idempotent replace
    const c2 = await api(tokenA, "POST", "/customers", bob("Bob Buyer Renamed"));
    check("A re-POST same id updates, not duplicates", c2.status === 201 && data(c2).values.customer_name === "Bob Buyer Renamed");
    const listA = await api(tokenA, "GET", "/customers");
    check("A list has exactly 1 customer (no duplicate)", data(listA).items.length === 1);

    // isolation: B cannot see/touch A's customer
    check("B GET A's customer -> 404", (await api(tokenB, "GET", `/customers/${cid}`)).status === 404);
    check("B PATCH A's customer -> 404", (await api(tokenB, "PATCH", `/customers/${cid}`, { values: { customer_name: "hax" } })).status === 404);
    check("B DELETE A's customer -> 404", (await api(tokenB, "DELETE", `/customers/${cid}`)).status === 404);
    const collide = await api(tokenB, "POST", "/customers", { id: cid, values: { customer_name: "B tries A's id" } });
    check("B POST with A's id -> 409 (no overwrite)", collide.status === 409);
    // prove A's row is untouched by B's attempts
    const stillA = await api(tokenA, "GET", `/customers/${cid}`);
    check("A's customer name unchanged after B's attempts", data(stillA).values.customer_name === "Bob Buyer Renamed");
    check("B list is empty (never saw A's customer)", data(await api(tokenB, "GET", "/customers")).items.length === 0);

    console.log("\ncustomer — search + PATCH merge");
    await api(tokenA, "POST", "/customers", { values: { customer_name: "Charlie Corp", customer_phone: "5550001111", customer_gstin: "29PQRSX5678K1Z3" } });
    const search = await api(tokenA, "GET", "/customers?q=charlie");
    check("A search q=charlie finds Charlie", data(search).items.length === 1 && data(search).items[0].values.customer_name === "Charlie Corp");
    const searchPhone = await api(tokenA, "GET", "/customers?q=98765");
    check("A search by phone fragment finds Bob", data(searchPhone).items.some((c: any) => c.id === cid));
    const searchGstin = await api(tokenA, "GET", "/customers?q=pqrsx");
    check("A search by GSTIN fragment finds Charlie", data(searchGstin).items.length === 1);
    const patch = await api(tokenA, "PATCH", `/customers/${cid}`, { values: { customer_email: "bob@x.com" } });
    check("A PATCH merges (email set, name preserved)",
      data(patch).values.customer_email === "bob@x.com" && data(patch).values.customer_name === "Bob Buyer Renamed");
    const renamed = await api(tokenA, "PATCH", `/customers/${cid}`, { values: { customer_name: "Zed Buyer" } });
    check("a PATCHed name is what search sees", renamed.status === 200 &&
      data(await api(tokenA, "GET", "/customers?q=zed")).items.some((c: any) => c.id === cid));

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
