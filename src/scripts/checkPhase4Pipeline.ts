/**
 * End-to-end Phase 4 verification: the full authoring -> serving pipeline, plus premium
 * enforcement and version immutability. Requires a reachable Postgres (DATABASE_URL) and the
 * dev server running (uses the real ADMIN_API_KEY from config).
 *
 *   npm run dev            (one shell)
 *   npm run check:phase4   (another)
 */
import { prisma } from "../prisma/client";
import { config } from "../config/env";
import { generateAccessToken } from "../common/utils/jwt";

const BASE = `http://localhost:${config.port}`;
const adminHeaders = { Authorization: `Bearer ${config.adminApiKey}`, "Content-Type": "application/json" };

let passed = 0;
let failed = 0;
const ok = (label: string, cond: boolean, detail = ""): void => {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};

interface Res { status: number; body: any; etag?: string; cacheControl?: string }
const call = async (
  method: string,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {}
): Promise<Res> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: opts.headers ?? {},
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const body = await res.json().catch(() => ({}));
  return {
    status: res.status,
    body,
    etag: res.headers.get("etag") ?? undefined,
    cacheControl: res.headers.get("cache-control") ?? undefined,
  };
};

// A tiny valid template and an invalid one.
const HTML = `<div data-page-size="A4"><h1>{{ invoice.number }}</h1><table><tbody><tr data-repeat="items as item"><td>{{ item.description }}</td><td>{{ item.amount | currency }}</td></tr></tbody></table></div>`;
const CSS = `.page { padding: 40px; } h1 { font-size: 20px; color: #123456; }`;
const BAD_HTML = `<div><script>alert(1)</script></div>`;

const FREE = "test-free-tmpl";
const PREM = "test-prem-tmpl";

const main = async (): Promise<void> => {
  try {
    await fetch(`${BASE}/`);
  } catch {
    console.error(`\nServer not reachable at ${BASE}. Start it with \`npm run dev\` first.\n`);
    process.exit(2);
  }

  // Fresh start.
  await prisma.templateVersion.deleteMany({ where: { templateId: { in: [FREE, PREM] } } });
  await prisma.template.deleteMany({ where: { id: { in: [FREE, PREM] } } });

  console.log("\nadmin authoring");
  const created = await call("POST", "/admin/templates", { headers: adminHeaders, body: { id: FREE, name: "Test Free" } });
  ok("create template -> 201", created.status === 201 && created.body.data.id === FREE);

  const bad = await call("POST", `/admin/templates/${FREE}/versions`, { headers: adminHeaders, body: { html: BAD_HTML, css: "" } });
  ok("invalid template -> 400 TEMPLATE_COMPILE_FAILED", bad.status === 400 && bad.body.code === "TEMPLATE_COMPILE_FAILED", JSON.stringify(bad.body));
  ok("compile error names the offending tag", /unsupported tag <script>/.test(bad.body.message || ""), bad.body.message);
  const draftCount = await prisma.templateVersion.count({ where: { templateId: FREE } });
  ok("rejected template is NOT stored", draftCount === 0, `found ${draftCount} versions`);

  const v1 = await call("POST", `/admin/templates/${FREE}/versions`, { headers: adminHeaders, body: { html: HTML, css: CSS } });
  ok("valid template -> 201 draft v1 with compiled JSON", v1.status === 201 && v1.body.data.version === 1 && v1.body.data.compiled.schemaVersion === 1);

  console.log("\npublic serving before publish");
  const preList = await call("GET", "/templates");
  ok("template hidden from public list until published? (current=null still listed)", preList.body.data.items.some((t: any) => t.id === FREE && t.currentVersion === null));
  const preComp = await call("GET", `/templates/${FREE}/compiled`);
  ok("compiled before publish -> 404", preComp.status === 404);
  const draftServe = await call("GET", `/templates/${FREE}/compiled?version=1`);
  ok("draft version not served publicly -> 404", draftServe.status === 404);

  console.log("\npublish + serve");
  const pub = await call("POST", `/admin/templates/${FREE}/versions/1/publish`, { headers: adminHeaders });
  ok("publish v1 -> 200 Published", pub.status === 200 && pub.body.data.status === "Published");
  const rePub = await call("POST", `/admin/templates/${FREE}/versions/1/publish`, { headers: adminHeaders });
  ok("re-publish v1 -> 409 (immutable)", rePub.status === 409);

  const comp = await call("GET", `/templates/${FREE}/compiled`);
  ok("compiled after publish -> 200 with render tree", comp.status === 200 && comp.body.data.root.type === "box");
  ok("response carries an ETag", !!comp.etag);
  ok("free template current -> Cache-Control public", (comp.cacheControl || "").includes("public"), comp.cacheControl);
  const notMod = await call("GET", `/templates/${FREE}/compiled`, { headers: { "If-None-Match": comp.etag! } });
  ok("If-None-Match matching ETag -> 304", notMod.status === 304);
  const byVersion = await call("GET", `/templates/${FREE}/compiled?version=1`);
  ok("?version=1 -> 200", byVersion.status === 200);
  const v1Etag = byVersion.etag;
  const missingVersion = await call("GET", `/templates/${FREE}/compiled?version=99`);
  ok("?version=99 -> 404", missingVersion.status === 404);

  console.log("\nimmutability: editing publishes a NEW version, old one unchanged");
  const oldChecksum = comp.etag;
  await call("POST", `/admin/templates/${FREE}/versions`, { headers: adminHeaders, body: { html: HTML, css: `.page{padding:60px;}` } });
  const pub2 = await call("POST", `/admin/templates/${FREE}/versions/2/publish`, { headers: adminHeaders });
  ok("publish v2 -> 200", pub2.status === 200);
  const v1Still = await call("GET", `/templates/${FREE}/compiled?version=1`);
  ok("v1 still serves 200 with its ORIGINAL checksum (immutable)", v1Still.status === 200 && v1Still.etag === v1Etag, `was ${v1Etag}, now ${v1Still.etag}`);
  const nowCurrent = await call("GET", `/templates/${FREE}/compiled`);
  ok("current now resolves to v2 (ETag changed from v1)", nowCurrent.etag !== oldChecksum);

  console.log("\npremium enforcement");
  await call("POST", "/admin/templates", { headers: adminHeaders, body: { id: PREM, name: "Test Premium", isPremium: true } });
  const pv = await call("POST", `/admin/templates/${PREM}/versions`, { headers: adminHeaders, body: { html: HTML, css: CSS } });
  await call("POST", `/admin/templates/${PREM}/versions/${pv.body.data.version}/publish`, { headers: adminHeaders });

  const anon = await call("GET", `/templates/${PREM}/compiled`);
  ok("premium compiled anonymously -> 403 PREMIUM_REQUIRED", anon.status === 403 && anon.body.code === "PREMIUM_REQUIRED");

  const suffix = Date.now();
  const freeUser = await prisma.user.create({ data: { googleId: `g-free-${suffix}`, email: `free-${suffix}@t.local`, name: "Free", isPremium: false } });
  const premUser = await prisma.user.create({ data: { googleId: `g-prem-${suffix}`, email: `prem-${suffix}@t.local`, name: "Prem", isPremium: true } });
  const freeTok = generateAccessToken(freeUser.id);
  const premTok = generateAccessToken(premUser.id);

  const asFree = await call("GET", `/templates/${PREM}/compiled`, { headers: { Authorization: `Bearer ${freeTok}` } });
  ok("premium compiled as non-premium user -> 403", asFree.status === 403);
  const asPrem = await call("GET", `/templates/${PREM}/compiled`, { headers: { Authorization: `Bearer ${premTok}` } });
  ok("premium compiled as premium user -> 200", asPrem.status === 200 && asPrem.body.data.root.type === "box");
  ok("premium response is NOT shared-cacheable (Cache-Control private)", (asPrem.cacheControl || "").includes("private") && !(asPrem.cacheControl || "").includes("public"), asPrem.cacheControl);
  const asPremVer = await call("GET", `/templates/${PREM}/compiled?version=1`, { headers: { Authorization: `Bearer ${premTok}` } });
  ok("premium ?version= -> private + immutable (per-user cache only)", (asPremVer.cacheControl || "").includes("private") && (asPremVer.cacheControl || "").includes("immutable"), asPremVer.cacheControl);
  ok("premium template still appears in the public list (upsell)", (await call("GET", "/templates")).body.data.items.some((t: any) => t.id === PREM && t.isPremium === true));

  // cleanup
  await prisma.templateVersion.deleteMany({ where: { templateId: { in: [FREE, PREM] } } });
  await prisma.template.deleteMany({ where: { id: { in: [FREE, PREM] } } });
  await prisma.user.deleteMany({ where: { id: { in: [freeUser.id, premUser.id] } } });
  await prisma.$disconnect();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
