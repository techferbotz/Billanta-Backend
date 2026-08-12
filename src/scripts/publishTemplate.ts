/**
 * Publish an invoice template LIVE via the admin API: create the template (if new), compile + store a
 * version, then publish it (making it the current, immutable version the app serves). Run this only
 * AFTER verifyTemplate.ts passes — the server re-compiles here and rejects a bad template with 400,
 * but verify also catches theme stragglers the API does not.
 *
 * Standalone (uses global fetch; imports nothing from the app, so no env validation runs).
 *
 * Usage:
 *   ADMIN_API_KEY=<key> npx ts-node src/scripts/publishTemplate.ts \
 *     --id <slug> --name "<Name>" --category "<Category>" [--description "..."] [--premium] \
 *     [--base https://billanta.ferbotz.com] --html <html-file> --css <css-file>
 */
import { readFileSync } from "node:fs";

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const id = arg("id");
const name = arg("name");
const category = arg("category") ?? "Business";
const description = arg("description");
const isPremium = flag("premium");
const base = (arg("base") ?? "https://billanta.ferbotz.com").replace(/\/+$/, "");
const htmlPath = arg("html");
const cssPath = arg("css");
const key = process.env.ADMIN_API_KEY;

if (!id || !name || !htmlPath || !cssPath) {
  console.error("usage: --id <slug> --name <name> --html <file> --css <file> [--category --description --premium --base]");
  process.exit(2);
}
if (!key) {
  console.error("ADMIN_API_KEY env var is required (fetch it from the server .env).");
  process.exit(2);
}
if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(id)) {
  console.error(`--id "${id}" must be a lowercase slug (a-z, 0-9, hyphen).`);
  process.exit(2);
}

const html = readFileSync(htmlPath, "utf8");
const css = readFileSync(cssPath, "utf8");

const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: res.status, json };
};

const main = async (): Promise<void> => {
  // 1. Create the template. 409 = it already exists; that's fine — we just add a new version below.
  const c = await call("POST", "/admin/templates", { id, name, description, category, isPremium });
  if (c.status === 201) console.log(`created template "${id}"`);
  else if (c.status === 409) console.log(`template "${id}" already exists — adding a new version`);
  else {
    console.error(`create template failed (${c.status}): ${c.json?.message ?? JSON.stringify(c.json)}`);
    process.exit(1);
  }

  // 2. Compile + store a Draft version. The server compiles; a bad template is a 400 with the exact
  //    located compiler message and nothing is stored.
  const v = await call("POST", `/admin/templates/${id}/versions`, { html, css });
  if (v.status !== 201) {
    console.error(`create version failed (${v.status}): ${v.json?.message ?? JSON.stringify(v.json)}`);
    process.exit(1);
  }
  const version = v.json?.data?.version;
  if (typeof version !== "number") {
    console.error("create-version response did not include a version number: " + JSON.stringify(v.json));
    process.exit(1);
  }
  console.log(`compiled + stored draft v${version} (checksum ${String(v.json?.data?.checksum ?? "").slice(0, 12)}…)`);

  // 3. Publish it — becomes the current, immutable version the app serves.
  const p = await call("POST", `/admin/templates/${id}/versions/${version}/publish`);
  if (p.status !== 200) {
    console.error(`publish failed (${p.status}): ${p.json?.message ?? JSON.stringify(p.json)}`);
    process.exit(1);
  }

  console.log(`\nPUBLISHED — "${id}" v${version} is now live${isPremium ? " (premium)" : ""}.`);
  console.log(`  in the picker:  GET ${base}/templates`);
  console.log(`  compiled tree:  ${base}/templates/${id}/compiled`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
