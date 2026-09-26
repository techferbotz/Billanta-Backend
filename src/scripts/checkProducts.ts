/**
 * End-to-end check of /products: the photo fields (APP-015 acceptance) plus the ownership rules
 * products share with customers, which check:phase3 predates and never covered.
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

  // What POST /media returns, in shape (nothing is fetched).
  const media = (n: number) => ({
    imageUrl: `https://billanta-media.s3.ap-south-1.amazonaws.com/media/${A.id}/${n}.webp`,
    imageThumbnailUrl: `https://billanta-media.s3.ap-south-1.amazonaws.com/media/${A.id}/${n}_thumb.webp`,
  });
  const pid = "22222222-2222-4222-8222-222222222222";

  try {
    console.log("\nphoto — APP-015 acceptance");
    const created = await api(tokenA, "POST", "/products", {
      id: pid,
      name: "Ceramic mug",
      unitPrice: "25000",
      taxRatePercent: "12",
      ...media(1),
    });
    check("POST with both photo fields -> 201", created.status === 201, JSON.stringify(created.body));
    check(
      "POST echoes both photo fields",
      data(created)?.imageUrl === media(1).imageUrl &&
        data(created)?.imageThumbnailUrl === media(1).imageThumbnailUrl
    );
    const got = data(await api(tokenA, "GET", `/products/${pid}`));
    check(
      "GET /products/:id returns both",
      got?.imageUrl === media(1).imageUrl && got?.imageThumbnailUrl === media(1).imageThumbnailUrl
    );
    const listed = data(await api(tokenA, "GET", "/products"))?.items?.find((p: any) => p.id === pid);
    check(
      "the GET /products page returns both (the app's pull)",
      listed?.imageUrl === media(1).imageUrl && listed?.imageThumbnailUrl === media(1).imageThumbnailUrl
    );

    const priceOnly = data(await api(tokenA, "PATCH", `/products/${pid}`, { unitPrice: "27500" }));
    check(
      "PATCH without the keys leaves the photo unchanged",
      priceOnly?.unitPrice === "27500" && priceOnly?.imageUrl === media(1).imageUrl
    );
    const swapped = data(await api(tokenA, "PATCH", `/products/${pid}`, media(2)));
    check(
      "PATCH with both keys replaces the photo",
      swapped?.imageUrl === media(2).imageUrl && swapped?.imageThumbnailUrl === media(2).imageThumbnailUrl
    );
    const cleared = data(
      await api(tokenA, "PATCH", `/products/${pid}`, { imageUrl: null, imageThumbnailUrl: null })
    );
    check(
      "PATCH with both set to null removes them",
      cleared?.imageUrl === null && cleared?.imageThumbnailUrl === null && cleared?.name === "Ceramic mug"
    );

    const legacy = await api(tokenA, "POST", "/products", { name: "Design hour", unitPrice: "150000" });
    check("an older-style body without the keys is still accepted -> 201", legacy.status === 201);
    check(
      "…and comes back WITH both keys, null (the feature probe)",
      "imageUrl" in (data(legacy) ?? {}) && data(legacy)?.imageUrl === null && data(legacy)?.imageThumbnailUrl === null
    );
    const unknown = await api(tokenA, "POST", "/products", { name: "Sticker", colour: "red" });
    check("an unknown key is ignored, not rejected -> 201", unknown.status === 201);

    console.log("\nphoto — POST is a full replace");
    await api(tokenA, "PATCH", `/products/${pid}`, media(3));
    const replaced = data(
      await api(tokenA, "POST", "/products", { id: pid, name: "Ceramic mug", unitPrice: "27500" })
    );
    check("re-POST of the same id without the keys clears the photo", replaced?.imageUrl === null);

    console.log("\nphoto — validation (400, row untouched)");
    await api(tokenA, "PATCH", `/products/${pid}`, media(4));
    for (const [label, bad] of [
      ["http://", "http://cdn.example.com/1.webp"],
      ["file://", "file:///data/user/0/com.billanta/files/photo.jpg"],
      ["content://", "content://media/external/images/media/12"],
      ["relative path", "/media/u/1.webp"],
      ["a number", 42],
      ["over 1000 chars", `https://cdn.example.com/${"a".repeat(1000)}`],
    ] as const) {
      const r = await api(tokenA, "PATCH", `/products/${pid}`, { imageUrl: bad });
      check(`PATCH imageUrl = ${label} -> 400`, r.status === 400, `got ${r.status}`);
    }
    const badPost = await api(tokenA, "POST", "/products", { name: "Bad", imageThumbnailUrl: "ftp://x/y.webp" });
    check("POST with a non-https thumbnail -> 400", badPost.status === 400);
    const intact = data(await api(tokenA, "GET", `/products/${pid}`));
    check("the rejected writes left the stored photo alone", intact?.imageUrl === media(4).imageUrl);

    console.log("\nownership — B can never see or touch A's product (404, never 403)");
    check("B GET A's product -> 404", (await api(tokenB, "GET", `/products/${pid}`)).status === 404);
    check(
      "B PATCH A's product -> 404",
      (await api(tokenB, "PATCH", `/products/${pid}`, { imageUrl: null })).status === 404
    );
    check("B DELETE A's product -> 404", (await api(tokenB, "DELETE", `/products/${pid}`)).status === 404);
    const collide = await api(tokenB, "POST", "/products", { id: pid, name: "B tries A's id" });
    check("B POST with A's id -> 409 (no overwrite)", collide.status === 409);
    const stillA = data(await api(tokenA, "GET", `/products/${pid}`));
    check(
      "A's product and photo unchanged after B's attempts",
      stillA?.name === "Ceramic mug" && stillA?.imageUrl === media(4).imageUrl
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
