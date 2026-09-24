/**
 * Render picker thumbnails (APP-012) for templates whose CURRENT version has none — the one-off
 * backfill for templates published before thumbnails existed, and the command-line retry for a
 * render that failed. Works through the admin API, so the server does the rendering and storage
 * exactly as it does on publish.
 *
 * Usage:
 *   ADMIN_API_KEY=<key> npx ts-node src/scripts/backfillThumbnails.ts [--base https://billanta.ferbotz.com]
 *        [--id <slug>]   only this template (active or not)
 *        [--force]       re-render even when the current version already has a thumbnail
 *
 * Standalone (global fetch; imports nothing from the app, so no env validation runs). Exits 1 if any
 * render failed.
 */
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const base = (arg("base") ?? "https://billanta.ferbotz.com").replace(/\/+$/, "");
const only = arg("id");
const force = process.argv.includes("--force");
const key = process.env.ADMIN_API_KEY;
if (!key) {
  console.error("ADMIN_API_KEY env var is required (fetch it from the server .env).");
  process.exit(2);
}

interface AdminTemplate { id: string; isActive: boolean; currentVersionId: string | null }
interface AdminVersion { id: string; version: number; thumbnailUrl: string | null; thumbnailError: string | null }

const call = async <T>(method: string, path: string): Promise<T> => {
  const res = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${key}` } });
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: T; message?: string };
  if (!res.ok || body.success === false || body.data === undefined) {
    throw new Error(`${method} ${path} -> ${res.status}: ${body.message ?? "no data"}`);
  }
  return body.data;
};

const main = async (): Promise<void> => {
  const { items } = await call<{ items: AdminTemplate[] }>("GET", "/admin/templates");
  const targets = items.filter((t) => (only ? t.id === only : t.isActive) && t.currentVersionId);
  if (only && targets.length === 0) throw new Error(`no template "${only}" with a published version`);

  let failed = 0;
  for (const t of targets) {
    const { versions } = await call<{ versions: AdminVersion[] }>("GET", `/admin/templates/${t.id}`);
    const current = versions.find((v) => v.id === t.currentVersionId);
    if (!current) {
      console.warn(`  skip  ${t.id} — current version not in its version list`);
      continue;
    }
    if (current.thumbnailUrl && !force) {
      console.log(`  have  ${t.id.padEnd(10)} v${current.version}  ${current.thumbnailUrl}`);
      continue;
    }
    const r = await call<{ thumbnail: { status: string; url?: string; error?: string } }>(
      "POST", `/admin/templates/${t.id}/versions/${current.version}/thumbnail`);
    if (r.thumbnail.status === "ok") {
      console.log(`  made  ${t.id.padEnd(10)} v${current.version}  ${r.thumbnail.url}`);
    } else {
      failed++;
      console.error(`  FAIL  ${t.id.padEnd(10)} v${current.version}  ${r.thumbnail.error}`);
    }
  }
  console.log(`\n${targets.length} template(s) checked, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
