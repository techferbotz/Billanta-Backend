/**
 * End-to-end check of /products: the values map (line ids, docs/FIELDS.md §7.5), the photo as an
 * image value (APP-015), plus the ownership rules products share with customers, which check:phase3
 * predates and never covered.
 *
 * Requires BOTH a reachable, migrated Postgres (DATABASE_URL) and the dev server running on PORT.
 * Run:  npm run dev            (in one shell)
 *       npm run check:products (in another)
 *
 * Seeds two throwaway users directly via Prisma, mints an access token for each, then drives the
 * live HTTP API. Everything it creates is deleted at the end.
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
    data: { googleId: `g-pA-${suffix}`, email: `pa-${suffix}@test.local`, name: "User A" },
  });
  const B = await prisma.user.create({
    data: { googleId: `g-pB-${suffix}`, email: `pb-${suffix}@test.local`, name: "User B" },
  });
  const tokenA = generateAccessToken(A.id);
  const tokenB = generateAccessToken(B.id);

  // What POST /media returns, as an image value (nothing is fetched).
  const media = (n: number) => ({
    url: `https://billanta-media.s3.ap-south-1.amazonaws.com/media/${A.id}/${n}.webp`,
    thumbnailUrl: `https://billanta-media.s3.ap-south-1.amazonaws.com/media/${A.id}/${n}_thumb.webp`,
  });
  const pid = "22222222-2222-4222-8222-222222222222";
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  try {
    console.log("\nvalues + photo");
    const created = await api(tokenA, "POST", "/products", {
      id: pid,
      values: { description: "Ceramic mug", unit_price: "25000", tax_rate: "12", image: media(1) },
    });
    check("POST with a photo -> 201", created.status === 201, JSON.stringify(created.body));
    check("POST echoes the photo", same(data(created)?.values?.image, media(1)));
    const got = data(await api(tokenA, "GET", `/products/${pid}`));
    check("GET /products/:id returns it", same(got?.values?.image, media(1)) && got?.values?.unit_price === "25000");
    const listed = data(await api(tokenA, "GET", "/products"))?.items?.find((p: any) => p.id === pid);
    check("the GET /products page returns it (the app's pull)", same(listed?.values?.image, media(1)));
    const searched = data(await api(tokenA, "GET", "/products?q=mug"))?.items ?? [];
    check("?q= matches the description", searched.length === 1 && searched[0].id === pid);

    const priceOnly = data(await api(tokenA, "PATCH", `/products/${pid}`, { values: { unit_price: "27500" } }));
    check("PATCH without the photo leaves it unchanged",
      priceOnly?.values?.unit_price === "27500" && same(priceOnly?.values?.image, media(1)));
    const swapped = data(await api(tokenA, "PATCH", `/products/${pid}`, { values: { image: media(2) } }));
    check("PATCH with a photo replaces it", same(swapped?.values?.image, media(2)));
    const cleared = data(await api(tokenA, "PATCH", `/products/${pid}`, { values: { image: null } }));
    check("PATCH with null removes it", !("image" in (cleared?.values ?? {})) && cleared?.values?.description === "Ceramic mug");

    const quantity = await api(tokenA, "POST", "/products", { values: { description: "Sticker", quantity: "2" } });
    check("a product can't carry a quantity -> 400", quantity.status === 400);
    const unknown = await api(tokenA, "POST", "/products", { values: { description: "Sticker", colour: "red" } });
    check("an unknown field id -> 400, never silently dropped", unknown.status === 400);

    console.log("\nPOST is a full replace");
    await api(tokenA, "PATCH", `/products/${pid}`, { values: { image: media(3) } });
    const replaced = data(
      await api(tokenA, "POST", "/products", { id: pid, values: { description: "Ceramic mug", unit_price: "27500" } })
    );
    check("re-POST of the same id without the photo clears it", !("image" in (replaced?.values ?? {})));

    console.log("\nphoto — validation (400, row untouched)");
    await api(tokenA, "PATCH", `/products/${pid}`, { values: { image: media(4) } });
    for (const [label, bad] of [
      ["http://", { url: "http://cdn.example.com/1.webp" }],
      ["file://", { url: "file:///data/user/0/com.billanta/files/photo.jpg" }],
      ["content://", { url: "content://media/external/images/media/12" }],
      ["relative path", { url: "/media/u/1.webp" }],
      ["a bare string", "https://cdn.example.com/1.webp"],
      ["over 1000 chars", { url: `https://cdn.example.com/${"a".repeat(1000)}` }],
    ] as const) {
      const r = await api(tokenA, "PATCH", `/products/${pid}`, { values: { image: bad } });
      check(`PATCH image = ${label} -> 400`, r.status === 400, `got ${r.status}`);
    }
    const badPost = await api(tokenA, "POST", "/products", { values: { description: "Bad", image: { url: "https://x.example/a.webp", thumbnailUrl: "ftp://x/y.webp" } } });
    check("POST with a non-https thumbnail -> 400", badPost.status === 400);
    const intact = data(await api(tokenA, "GET", `/products/${pid}`));
    check("the rejected writes left the stored photo alone", same(intact?.values?.image, media(4)));

    console.log("\nownership — B can never see or touch A's product (404, never 403)");
    check("B GET A's product -> 404", (await api(tokenB, "GET", `/products/${pid}`)).status === 404);
    check(
      "B PATCH A's product -> 404",
      (await api(tokenB, "PATCH", `/products/${pid}`, { values: { image: null } })).status === 404
    );
    check("B DELETE A's product -> 404", (await api(tokenB, "DELETE", `/products/${pid}`)).status === 404);
    const collide = await api(tokenB, "POST", "/products", { id: pid, values: { description: "B tries A's id" } });
    check("B POST with A's id -> 409 (no overwrite)", collide.status === 409);
    const stillA = data(await api(tokenA, "GET", `/products/${pid}`));
    check(
      "A's product and photo unchanged after B's attempts",
      stillA?.values?.description === "Ceramic mug" && same(stillA?.values?.image, media(4))
    );
    check("B's list is empty", data(await api(tokenB, "GET", "/products"))?.items?.length === 0);

    console.log("\ndelete");
    check("A DELETE /products/:id -> 200", (await api(tokenA, "DELETE", `/products/${pid}`)).status === 200);
    check("…then GET -> 404", (await api(tokenA, "GET", `/products/${pid}`)).status === 404);
    check("A DELETE /users/me -> 200", (await api(tokenA, "DELETE", "/users/me")).status === 200);
    check(
      "A's remaining products cascade-deleted with the account",
      (await prisma.product.count({ where: { userId: A.id } })) === 0
    );
  } finally {
    // Cleanup — B (and A if the deletion test didn't run).
    await prisma.user.deleteMany({ where: { id: { in: [A.id, B.id] } } });
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
};

void main();
