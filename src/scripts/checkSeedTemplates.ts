/**
 * Proves every seed template compiles (no DB, no server), and that each is deterministic.
 * These are the authoring examples in the docs, so a broken one is a broken doc.
 *
 * Run: npx ts-node src/scripts/checkSeedTemplates.ts  (or npm run check:seeds)
 */
import { SEED_TEMPLATES } from "../templates/seed/seedTemplates";
import { compileTemplate } from "../templates/compile/compiler";
import { CompileError } from "../templates/compile/errors";

let passed = 0;
let failed = 0;

for (const t of SEED_TEMPLATES) {
  try {
    const a = compileTemplate(t.html, t.css);
    const b = compileTemplate(t.html, t.css);
    const deterministic = a.checksum === b.checksum;
    const hasRoot = a.compiled.root && a.compiled.root.type === "box";
    if (deterministic && hasRoot) {
      passed++;
      console.log(`  PASS  ${t.id.padEnd(9)} compiled (checksum ${a.checksum.slice(0, 12)}…, ${JSON.stringify(a.compiled).length} bytes)`);
    } else {
      failed++;
      console.error(`  FAIL  ${t.id} — deterministic=${deterministic} hasRoot=${!!hasRoot}`);
    }
  } catch (e) {
    failed++;
    const detail = e instanceof CompileError ? `${e.message}` : (e as Error).message;
    console.error(`  FAIL  ${t.id} — ${detail}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
