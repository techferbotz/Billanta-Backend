/**
 * Pre-flight for a candidate invoice template — run BEFORE publishing.
 *
 * Compiles the authored HTML+CSS through the real Billanta compiler and asserts it is:
 *   1. valid (compiles, no located rejection),
 *   2. deterministic (two compiles produce the same checksum),
 *   3. fully themed — every DRAWN element in a theme token's colour maps that style key to the token,
 *      so a user's colour override never leaves a stray element/run in the old colour (the APP-004/006
 *      lesson). Also prints the theme/sections(+edits)/customisation the tree exposes.
 *
 * Usage: npx ts-node src/scripts/verifyTemplate.ts <html-file> <css-file>
 * Exit 0 = PASS (safe to publish); non-zero = do not publish.
 */
import { readFileSync } from "node:fs";
import { compileTemplate } from "../templates/compile/compiler";
import { CompileError } from "../templates/compile/errors";

const [htmlPath, cssPath] = process.argv.slice(2);
if (!htmlPath || !cssPath) {
  console.error("usage: verifyTemplate.ts <html-file> <css-file>");
  process.exit(2);
}
const html = readFileSync(htmlPath, "utf8");
const css = readFileSync(cssPath, "utf8");

let a: ReturnType<typeof compileTemplate>;
let b: ReturnType<typeof compileTemplate>;
try {
  a = compileTemplate(html, css);
  b = compileTemplate(html, css);
} catch (err) {
  console.error("COMPILE FAILED: " + (err instanceof CompileError ? err.message : (err as Error).message));
  process.exit(1);
}

const problems: string[] = [];
if (a.checksum !== b.checksum) problems.push("non-deterministic — two compiles produced different output");

const compiled: any = a.compiled;
const tokens = compiled.theme?.tokens ?? {};
const defaultToToken: Record<string, string> = {};
for (const [name, def] of Object.entries<any>(tokens)) defaultToToken[String(def.default).toLowerCase()] = name;

const COLOR_KEYS = new Set([
  "color", "backgroundColor",
  "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
]);
let stragglers = 0;
const walk = (n: any): void => {
  if (!n || typeof n !== "object") return;
  if (n.style) {
    for (const [k, v] of Object.entries<any>(n.style)) {
      if (!COLOR_KEYS.has(k) || typeof v !== "string") continue;
      // Only DRAWN colour counts: `color` is drawn by a text node (a container's is merely inherited);
      // fills/borders are drawn by the container, never by a text node (its parent carries those).
      const drawn = k === "color" ? n.type === "text" : n.type !== "text";
      if (!drawn) continue;
      const tok = defaultToToken[v.toLowerCase()];
      if (tok && !(n.tokens && n.tokens[k] === tok)) stragglers++;
    }
  }
  if (Array.isArray(n.spans)) {
    for (const s of n.spans) {
      const c = typeof s.style?.color === "string" ? s.style.color.toLowerCase() : undefined;
      if (c) {
        const tok = defaultToToken[c];
        if (tok && !(s.tokens && s.tokens.color === tok)) stragglers++;
      }
    }
  }
  for (const key of ["children", "cells", "header", "footer"]) if (Array.isArray(n[key])) n[key].forEach(walk);
  if (n.body) { if (n.body.row) walk(n.body.row); if (Array.isArray(n.body.rows)) n.body.rows.forEach(walk); }
  if (n.child) walk(n.child);
};
walk(compiled.root);
if (stragglers > 0) {
  problems.push(
    `${stragglers} colour straggler(s) — an element drawn in a token's colour is not tokenised; a colour ` +
      `override would leave it in the old colour. Tokenise it (data-token) or use a non-token colour.`
  );
}

console.log(`checksum:      ${a.checksum.slice(0, 16)}…   (${JSON.stringify(compiled).length} bytes, deterministic=${a.checksum === b.checksum})`);
console.log(`theme.tokens:  ${JSON.stringify(compiled.theme?.tokens ?? null)}`);
console.log(`sections:      ${JSON.stringify((compiled.sections ?? []).map((s: any) => `${s.id}->${s.edits ?? "none"}`))}`);
console.log(`customisation: ${JSON.stringify((compiled.customisation ?? []).map((x: any) => x.type + (x.token ? `:${x.token}` : x.section ? `:${x.section}` : "")))}`);
console.log(`colour stragglers: ${stragglers}`);

if (problems.length) {
  console.error("\nFAIL:\n - " + problems.join("\n - "));
  process.exit(1);
}
console.log("\nPASS — compiles cleanly, deterministic, every themed colour is tokenised. Safe to publish.");
