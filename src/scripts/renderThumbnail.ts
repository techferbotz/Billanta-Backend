/**
 * Render a template's picker thumbnail LOCALLY — the exact image a publish would upload — without a
 * database, S3 or the server. For visual QA while authoring (the /new-invoice-template skill uses it)
 * and for eyeballing a live template.
 *
 * Usage (one source):
 *   npx ts-node src/scripts/renderThumbnail.ts --html t.html --css t.css --out t.png
 *   npx ts-node src/scripts/renderThumbnail.ts --id cobalt [--base https://billanta.ferbotz.com] --out cobalt.png
 *   npx ts-node src/scripts/renderThumbnail.ts --compiled tree.json --out t.webp
 *
 * `--out *.webp` writes the production bytes; `*.png` writes the raw render (easier to view).
 * `--width` overrides the 640 px default. A premium template can't be fetched by `--id` (403); use
 * its source instead.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { compileTemplate } from "../templates/compile/compiler";
import { CompiledTemplate } from "../templates/compile/nodes";
import { renderThumbnailPng, THUMBNAIL_WIDTH } from "../templates/render/renderThumbnail";
import { compressPageThumbnail } from "../storage/imageCompressor";

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function loadCompiled(): Promise<CompiledTemplate> {
  const html = arg("html");
  const compiledPath = arg("compiled");
  const id = arg("id");
  if (html) return compileTemplate(readFileSync(html, "utf8"), arg("css") ? readFileSync(arg("css") as string, "utf8") : "").compiled;
  if (compiledPath) {
    const json = JSON.parse(readFileSync(compiledPath, "utf8"));
    return (json.data ?? json) as CompiledTemplate; // accepts a raw tree or an API envelope
  }
  if (id) {
    const base = (arg("base") ?? "https://billanta.ferbotz.com").replace(/\/+$/, "");
    const res = await fetch(`${base}/templates/${encodeURIComponent(id)}/compiled`);
    const body = (await res.json()) as { success: boolean; data?: CompiledTemplate; message?: string };
    if (!res.ok || !body.success || !body.data) throw new Error(`GET /templates/${id}/compiled -> ${res.status}: ${body.message ?? "no tree"}`);
    return body.data;
  }
  throw new Error("give one of --html (+ --css), --compiled or --id");
}

async function main(): Promise<void> {
  const out = arg("out");
  if (!out) throw new Error("--out <file.png|file.webp> is required");
  const width = Number(arg("width") ?? THUMBNAIL_WIDTH);

  const started = Date.now();
  const png = await renderThumbnailPng(await loadCompiled(), width);
  const bytes = out.endsWith(".webp") ? await compressPageThumbnail(png, width) : png;
  writeFileSync(out, bytes);
  console.log(`wrote ${out} — ${width}px wide, ${(bytes.length / 1024).toFixed(1)} KB, ${Date.now() - started} ms`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
