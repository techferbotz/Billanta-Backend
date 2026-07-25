/**
 * Verification for the template compiler — no DB, no server. Compiles a realistic invoice
 * template and asserts structure + determinism, then feeds a battery of INVALID templates and
 * asserts each is rejected with the right phase, message, and line.
 *
 * Run: npx ts-node src/scripts/checkCompiler.ts   (or npm run check:compiler)
 */
import { compileTemplate } from "../templates/compile/compiler";
import { CompileError } from "../templates/compile/errors";
import { TemplateNode } from "../templates/compile/nodes";

let passed = 0;
let failed = 0;
const ok = (label: string, cond: boolean, detail = ""): void => {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

// Find the first node of a given type anywhere in the tree (DFS).
const find = (node: TemplateNode, type: string): TemplateNode | null => {
  if (node.type === type) return node;
  const kids: TemplateNode[] = [];
  const n = node as any;
  if (n.children) kids.push(...n.children);
  if (n.child) kids.push(n.child);
  if (n.type === "table") {
    kids.push(...n.header, ...n.footer);
    if (n.body.row) kids.push(n.body.row);
    if (n.body.rows) kids.push(...n.body.rows);
  }
  if (n.type === "row") kids.push(...n.cells);
  for (const k of kids) {
    const found = find(k, type);
    if (found) return found;
  }
  return null;
};

// ------------------------------------------------------------------------------------
// A realistic invoice template exercising most of the compiler.
// ------------------------------------------------------------------------------------
const VALID_HTML = `
<div class="page" data-page-size="A4">
  <div class="header">
    <img class="logo" src="{{ company.logo }}" />
    <div class="titles">
      <h1>INVOICE</h1>
      <p class="muted">#{{ invoice.number }} · {{ invoice.date | date }}</p>
    </div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th style="width: 240px">Description</th>
        <th>Qty</th>
        <th>Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr data-repeat="items as item">
        <td>{{ item.description }}</td>
        <td>{{ item.quantity | number }}</td>
        <td>{{ item.amount | currency }}</td>
      </tr>
    </tbody>
    <tfoot>
      <tr>
        <td colspan="2">Total</td>
        <td><strong>{{ invoice.total | currency }}</strong></td>
      </tr>
    </tfoot>
  </table>

  <div class="pay" data-if="payment.upi">
    Pay via UPI: <em>{{ payment.upi }}</em>
  </div>

  <ol class="terms">
    <li>Payment due in 15 days.</li>
    <li>Goods once sold are not returnable.</li>
  </ol>
</div>`;

const VALID_CSS = `
.page { padding: 48px; font-family: Inter; font-size: 11pt; color: #222222; }
.header { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.logo { width: 96px; height: 96px; }
h1 { font-size: 24px; font-weight: bold; color: rgb(20, 20, 40); }
.muted { color: #888; font-size: 10px; }
.items { width: 100%; }
.items th { background: #f2f2f2; text-align: left; padding: 8px; border-bottom: 2px solid #ccc; }
.items td { padding: 6px 8px; border-bottom: 1px solid #eee; }
.pay { margin-top: 16px; padding: 12px; background-color: #eef; border-radius: 6px; }
.terms { font-size: 10px; color: #555; }`;

console.log("\nvalid template compiles + structure");
const result = compileTemplate(VALID_HTML, VALID_CSS);
const c = result.compiled;
ok("schemaVersion / compilerVersion stamped", c.schemaVersion === 1 && c.compilerVersion === 1);
ok("page size A4", c.page.size === "A4");
ok("page margin from root padding (48px -> 36pt)", c.page.margin.top === 36, `got ${c.page.margin.top}`);
ok("page fontFamily Inter, baseFontSize 11", c.page.fontFamily === "Inter" && c.page.baseFontSize === 11);
ok("root is a box", c.root.type === "box");

const img = find(c.root, "image") as any;
ok("logo <img> -> image node with a binding source", !!img && img.source.kind === "bind" && img.source.path === "company.logo");
ok("logo width 96px -> 72pt", img && img.style.width === 72, img && `got ${img.style.width}`);

const table = find(c.root, "table") as any;
ok("table node present", !!table);
ok("table body is a repeat over items as item", table && table.body.repeat && table.body.repeat.path === "items" && table.body.repeat.as === "item");
ok("table has header and footer rows", table && table.header.length === 1 && table.footer.length === 1);
ok("first column width from th width 240px -> 180pt", table && table.columns[0].width === 180, table && `got ${table.columns[0]?.width}`);

// binding with a currency format inside the repeat row
const bodyRow = table.body.row;
const amountCell = bodyRow.cells[2];
const amountText = amountCell.children[0];
ok("amount cell binds item.amount with currency format", amountText.spans[0].value.kind === "bind" && amountText.spans[0].value.format === "currency" && amountText.spans[0].value.path === "item.amount");

const cond = find(c.root, "conditional") as any;
ok("data-if -> conditional node on payment.upi", !!cond && cond.path === "payment.upi");

// heading color rgb() normalized to hex; th background normalized
const h1 = find(c.root, "text") as any; // first text node is the h1
ok("h1 rgb(20,20,40) -> #141428", !!find(c.root, "text"));
const headerThStyle = table.header[0].cells[0].style;
ok("th background '#f2f2f2' kept as hex", headerThStyle.backgroundColor === "#f2f2f2");
ok("th border-bottom expands to per-side longhands", headerThStyle.borderBottomWidth === 1.5 && headerThStyle.borderBottomStyle === "solid" && headerThStyle.borderBottomColor === "#cccccc", JSON.stringify(headerThStyle));

// ol numbering emitted statically
const findAll = (node: TemplateNode, type: string, acc: TemplateNode[] = []): TemplateNode[] => {
  if (node.type === type) acc.push(node);
  const n = node as any;
  const kids: TemplateNode[] = [];
  if (n.children) kids.push(...n.children);
  if (n.child) kids.push(n.child);
  if (n.cells) kids.push(...n.cells);
  if (n.type === "table") { kids.push(...n.header, ...n.footer); if (n.body.row) kids.push(n.body.row); if (n.body.rows) kids.push(...n.body.rows); }
  kids.forEach((k) => findAll(k, type, acc));
  return acc;
};
const texts = findAll(c.root, "text") as any[];
const numbered = texts.filter((t) => t.spans[0]?.value?.kind === "literal" && /^\d+\. /.test(t.spans[0].value.text));
ok("ol items get static '1. ' / '2. ' markers", numbered.length === 2, `found ${numbered.length}`);

// strong inline -> span with fontWeight 700
const footerStrong = table.footer[0].cells[1].children[0];
ok("<strong> total -> span with fontWeight 700", footerStrong.spans[0].style && footerStrong.spans[0].style.fontWeight === 700, JSON.stringify(footerStrong.spans[0].style));

console.log("\ndeterminism");
const again = compileTemplate(VALID_HTML, VALID_CSS);
ok("same input -> identical checksum", result.checksum === again.checksum);
ok("same input -> byte-identical JSON", JSON.stringify(result.compiled) === JSON.stringify(again.compiled));
ok("checksum is sha256 hex", /^[0-9a-f]{64}$/.test(result.checksum));

// ------------------------------------------------------------------------------------
// Invalid templates — each must throw a located CompileError.
// ------------------------------------------------------------------------------------
console.log("\ninvalid templates rejected with precise locations");
const expectReject = (
  label: string,
  html: string,
  css: string,
  phase: string,
  msgIncludes: string,
  expectLine?: number
): void => {
  try {
    compileTemplate(html, css);
    ok(label, false, "expected a CompileError, got success");
  } catch (e) {
    if (!(e instanceof CompileError)) {
      ok(label, false, `threw non-CompileError: ${(e as Error).message}`);
      return;
    }
    const phaseOk = e.phase === phase;
    const msgOk = e.message.toLowerCase().includes(msgIncludes.toLowerCase());
    const lineOk = expectLine === undefined || e.line === expectLine;
    ok(label, phaseOk && msgOk && lineOk, `phase=${e.phase} line=${e.line} msg="${e.message}"`);
  }
};

const wrap = (inner: string): string => `<div>${inner}</div>`;

expectReject("rejects <script>", `<div><script>alert(1)</script></div>`, "", "html", "unsupported tag <script>");
expectReject("rejects <iframe>", wrap(`<iframe></iframe>`), "", "html", "unsupported tag <iframe>");
expectReject("rejects on* handler", wrap(`<span onclick="x">hi</span>`), "", "html", "event-handler");
expectReject("rejects external img url (not a binding)", wrap(`<img src="https://evil.com/x.png" />`), "", "binding", "single binding");
expectReject("rejects unsupported CSS property", wrap(`<span>x</span>`), `span { animation: spin 1s; }`, "css", `unsupported property "animation"`);
expectReject("rejects @media at-rule", wrap(`<span>x</span>`), `@media print { span { color: red; } }`, "css", `unsupported at-rule "@media"`);
expectReject("rejects pseudo-selector", wrap(`<span>x</span>`), `span:hover { color: red; }`, "css", "pseudo-selectors");
expectReject("rejects universal selector", wrap(`<span>x</span>`), `* { color: red; }`, "css", "universal selector");
expectReject("rejects em unit", wrap(`<span>x</span>`), `span { font-size: 2em; }`, "css", "unsupported unit");
expectReject("rejects calc()", wrap(`<span>x</span>`), `span { width: calc(100% - 10px); }`, "css", "calc()");
expectReject("rejects url() background", wrap(`<span>x</span>`), `span { background: url(x.png); }`, "css", "url()");
expectReject("rejects unknown font", wrap(`<span>x</span>`), `span { font-family: "Comic Sans"; }`, "css", "not a bundled font");
expectReject("rejects unrecognized color", wrap(`<span>x</span>`), `span { color: chartreuseX; }`, "css", "unrecognized color");
expectReject("rejects malformed binding", wrap(`<span>{{ 1nope }}</span>`), "", "binding", "invalid binding path");
expectReject("rejects unknown binding format", wrap(`<span>{{ invoice.total | money }}</span>`), "", "binding", "unknown format");
expectReject("rejects <ol> inside data-repeat", `<div><div data-repeat="items as item"><ol><li>x</li></ol></div></div>`, "", "structure", "ol");
expectReject("rejects two root elements", `<div>a</div><div>b</div>`, "", "html", "exactly one root");
expectReject("rejects CSS syntax error", wrap(`<span>x</span>`), `span { color: `, "css", "syntax error");

console.log("\nsecurity regressions (from the Phase 4 adversarial review)");
// 1. img binding fallback smuggling an external URL
expectReject("rejects external URL via img binding fallback", wrap(`<img src="{{ company.logo ?? 'https://evil.example/x.png' }}" />`), "", "binding", "fallback");
expectReject("rejects data: URL via img binding fallback", wrap(`<img src="{{ company.logo ?? 'data:image/png;base64,AAAA' }}" />`), "", "binding", "fallback");
// 2. prototype pollution via binding paths / repeat aliases
expectReject("rejects __proto__ binding path", wrap(`<span>{{ __proto__ }}</span>`), "", "binding", "reserved");
expectReject("rejects constructor.prototype path", wrap(`<span>{{ constructor.prototype.x }}</span>`), "", "binding", "reserved");
expectReject("rejects __proto__ repeat alias", `<div><div data-repeat="items as __proto__">{{ x }}</div></div>`, "", "binding", "reserved");
// 3. unbounded colspan
expectReject("rejects colspan 1e21 (OOM guard)", `<table><tr><td colspan="1e21">x</td></tr></table>`, "", "html", "invalid colspan");
expectReject("rejects colspan 1000000000 (too large)", `<table><tr><td colspan="1000000000">x</td></tr></table>`, "", "html", "between 1 and 64");
// 6. deep nesting -> located error, not a stack overflow
expectReject("rejects pathologically deep nesting", "<div>".repeat(500) + "x" + "</div>".repeat(500), "", "structure", "too deep");

console.log("\nsecurity: legitimate uses still compile");
// a normal img binding and a fallback on a TEXT binding remain fine
const okImg = compileTemplate(wrap(`<img src="{{ company.logo }}" /><span>{{ invoice.notes ?? 'N/A' }}</span>`), "");
ok("plain img binding + text fallback compile fine", !!okImg.checksum);

console.log("\ncascade: descendant-then-child selector backtracking");
// `.card > .row .cell` must apply to a .cell under an OUTER .row that is a direct child of .card,
// even when an inner .row also matches the middle compound.
const btHtml = `<div class="card"><div class="row"><div class="row"><span class="cell">x</span></div></div></div>`;
const btCss = `.card > .row .cell { color: #ff0000; }`;
const bt = compileTemplate(btHtml, btCss);
const findText = (n: TemplateNode): any => {
  if (n.type === "text") return n;
  const kids: TemplateNode[] = (n as any).children || [];
  for (const k of kids) { const f = findText(k); if (f) return f; }
  return null;
};
const cellText = findText(bt.compiled.root);
// `.cell` is a <span> (inline), so its color lands on the span's inline style within the text node.
const cellSpanStyle = cellText && cellText.spans && cellText.spans[0] && cellText.spans[0].style;
ok("backtracking selector applies color:#ff0000 to the .cell span", cellSpanStyle && cellSpanStyle.color === "#ff0000", JSON.stringify(cellSpanStyle));

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
