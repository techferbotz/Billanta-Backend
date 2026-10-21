/**
 * Proves the picker-thumbnail renderer (APP-012) behaves — no DB, no S3, no server.
 *
 *  1. Layout rules, checked on trees produced by the REAL compiler (so a change in the compiler's
 *     output shapes shows up here): editorOnly dropped, data-unless honoured, unknown node types and
 *     style keys ignored, box styles drawn once (a cell's or div's text doesn't repeat them; a <p>
 *     keeps its own), table columns aligned across rows (colspan included), rupee formatting.
 *  2. Every seed template rendered through the sandboxed worker exactly as a publish would, and
 *     held to APP-012 §2: WebP, 640 px wide at A4 proportions, opaque, well under 100 KB, and
 *     byte-identical across two renders (§1 determinism).
 *
 * Run: npx ts-node src/scripts/checkThumbnails.ts  (or npm run check:thumbnails)
 */
import crypto from "crypto";
import sharp from "sharp";
import { compileTemplate } from "../templates/compile/compiler";
import { CompiledTemplate } from "../templates/compile/nodes";
import { Element, layoutPage, PAGE_SIZES } from "../templates/render/layout";
import { SAMPLE_INVOICE } from "../templates/render/sampleInvoice";
import { renderThumbnailPng, THUMBNAIL_WIDTH } from "../templates/render/renderThumbnail";
import { compressPageThumbnail } from "../storage/imageCompressor";
import { SEED_TEMPLATES } from "../templates/seed/seedTemplates";
import { FIELD_IDS } from "../fields/registry";

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail = ""): void => {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

const compile = (html: string, css = ""): CompiledTemplate =>
  compileTemplate(`<div data-page-size="A4">${html}</div>`, css).compiled;

// A section that lists `fields`, around `html` — so the html may print them.
const section = (fields: unknown[], html: string): string =>
  `<div data-section="s" data-fields='${JSON.stringify(fields)}'>${html}</div>`;
const LINE_COLUMNS = [
  { id: "description", label: "Item" },
  { id: "quantity", type: "number", label: "Qty" },
  { id: "tax_rate", label: "GST %" },
  { id: "line_total", label: "Amount" },
];

// Every element in document order, and the text runs with the element that holds them.
const elements = (root: Element): Element[] => {
  const out: Element[] = [];
  const walk = (e: Element) => {
    out.push(e);
    if (Array.isArray(e.props.children)) e.props.children.forEach(walk);
  };
  walk(root);
  return out;
};
const texts = (root: Element): { text: string; el: Element }[] =>
  elements(root).flatMap((el) =>
    typeof el.props.children === "string" ? [{ text: el.props.children, el }] : []);
const renderedText = (doc: CompiledTemplate) => texts(layoutPage(doc, SAMPLE_INVOICE).element).map((t) => t.text);

async function layoutRules(): Promise<void> {
  console.log("layout rules");

  const editor = renderedText(compile(`<div data-editor-only><div>DRAFT ONLY</div></div><div>visible</div>`));
  check("editorOnly nodes never appear in a thumbnail", editor.includes("visible") && !editor.some((t) => t.includes("DRAFT")));

  const gates = renderedText(compile(section([{ id: "notes", type: "multiline", label: "Notes" }],
    `<div data-unless="notes">NO NOTES</div><div data-if="notes">{{ notes }}</div>`)));
  check("data-if / data-unless gate on the sample data", !gates.includes("NO NOTES") &&
    gates.some((t) => t.startsWith("Thank you")));

  const zero = compile(`<div data-if="discount_total">HAS DISCOUNT</div>`);
  check("a decimal string equal to zero is falsy",
    renderedText(zero).includes("HAS DISCOUNT") &&
      !texts(layoutPage(zero, { ...SAMPLE_INVOICE, discount_total: "0.00" }).element).some((t) => t.text === "HAS DISCOUNT"));

  const state = renderedText(compile(section([{ id: "company_state" }], `<div>{{ company_state }}</div>`)));
  check("a select prints its option's label, not its value", state.includes("Karnataka") && !state.includes("29"),
    state.join(" | "));

  const missing = Object.entries(FIELD_IDS).filter(([id, spec]) => {
    if (spec.owner === "settings") return false; // defaults, never printed
    const line = (SAMPLE_INVOICE.line_items as Record<string, unknown>[])[0];
    const v = spec.owner === "line" || spec.owner === "line_computed" ? line[id] : SAMPLE_INVOICE[id];
    return v === undefined || v === null || v === "";
  }).map(([id]) => id);
  check("the sample invoice gives every registered field a value", missing.length === 0, missing.join(", "));

  const forward = compile(`<div>kept</div>`);
  (forward.root as { children: unknown[] }).children.push({ type: "hologram", style: {} });
  if (forward.root.type === "box") forward.root.style.shimmer = 5;
  let forwardOk = false;
  try {
    const page = layoutPage(forward, SAMPLE_INVOICE);
    forwardOk = !elements(page.element).some((e) => "shimmer" in e.props.style) &&
      texts(page.element).some((t) => t.text === "kept");
  } catch { /* forwardOk stays false */ }
  check("unknown node types and style keys are ignored, not fatal", forwardOk);

  const cell = compile(
    `<table><tbody><tr><td>cell text</td></tr></tbody></table>`, `td { padding: 10px; border: 1px solid #000000; }`);
  const run = texts(layoutPage(cell, SAMPLE_INVOICE).element).find((t) => t.text === "cell text");
  check("a <td>'s text run doesn't repeat the cell's padding and border",
    !!run && run.el.props.style.paddingTop === undefined && run.el.props.style.borderTopWidth === undefined,
    JSON.stringify(run?.el.props.style));

  // A <div> is a box whose text is an anonymous run: the box draws the padding, the run doesn't.
  const boxed = layoutPage(compile(`<div class="x">in a div</div>`, `.x { margin-bottom: 8px; padding: 4px; }`), SAMPLE_INVOICE);
  const divRun = texts(boxed.element).find((t) => t.text === "in a div");
  const divBox = elements(boxed.element).find((e) => Array.isArray(e.props.children) && divRun !== undefined &&
    e.props.children.includes(divRun.el));
  check("a <div>'s padding is drawn once, on its box — not again on its text",
    divBox?.props.style.paddingTop === 3 && divBox?.props.style.marginBottom === 6 && divRun?.el.props.style.paddingTop === undefined,
    `box=${JSON.stringify(divBox?.props.style)} run=${JSON.stringify(divRun?.el.props.style)}`);

  // A <p> compiles to a text node that IS the element, so it keeps its own box styles.
  const para = texts(layoutPage(compile(`<p class="x">a paragraph</p>`, `.x { margin-bottom: 8px; padding: 4px; }`), SAMPLE_INVOICE).element)
    .find((t) => t.text === "a paragraph");
  check("a <p> keeps its own margin and padding",
    para?.el.props.style.marginBottom === 6 && para?.el.props.style.paddingTop === 3, JSON.stringify(para?.el.props.style));

  const money = renderedText(compile(section([{ id: "invoice_date", label: "Date" }],
    `<div>{{ grand_total | currency }}</div><div>{{ invoice_date | date }}</div>`)));
  check("currency and date formatting", money.includes("₹89,025.00") && money.includes("01 Sep 2026"), money.join(" | "));

  const table = compile(section([{ id: "line_items", label: "Items", columns: LINE_COLUMNS }],
    `<table class="t"><thead><tr><th class="a">A</th><th>B</th><th>C</th></tr></thead>` +
      `<tbody><tr data-repeat="line_items as item"><td>{{ item.description }}</td><td>{{ item.quantity | number }}</td>` +
      `<td>{{ item.line_total | currency }}</td></tr></tbody><tfoot><tr><td colspan="2">x</td><td>y</td></tr></tfoot></table>`),
    `.t { width: 100%; } th.a { width: 50%; }`);
  const cellWidths = (doc: CompiledTemplate, data = SAMPLE_INVOICE) =>
    elements(layoutPage(doc, data).element)
      .filter((e) => e.props.style.flexShrink === 0 && typeof e.props.style.width === "number")
      .map((e) => e.props.style.width as number);
  const cells = cellWidths(table);
  const inner = PAGE_SIZES.A4.width - table.page.margin.left - table.page.margin.right;
  const [h0, h1, h2] = cells;
  const [f0, f1] = cells.slice(-2);
  const close = (a: number, b: number) => Math.abs(a - b) < 0.01;
  check("table columns: explicit width honoured, colspan cells line up with the header",
    cells.length === 3 + 4 * 3 + 2 && close(h0, inner / 2) && close(f0, h0 + h1) && close(f1, h2) && close(h0 + h1 + h2, inner),
    `cells=${cells.length} header=${[h0, h1, h2].map((w) => w?.toFixed(1))} footer=${[f0, f1].map((w) => w?.toFixed(1))}`);

  // A first-row condition hides the whole column; a spanning cell over it shrinks, and the
  // remaining columns take the full width again.
  const gst = compile(section(
    [{ id: "line_items", label: "Items", columns: LINE_COLUMNS }, { id: "hide_gst_column", type: "boolean", label: "Hide GST" }],
    `<table class="t"><thead><tr><th>Item</th><th data-unless="hide_gst_column">GST</th><th>Amount</th></tr></thead>` +
      `<tbody><tr data-repeat="line_items as item"><td>{{ item.description }}</td><td>{{ item.tax_rate | number }}%</td>` +
      `<td>{{ item.line_total | currency }}</td></tr></tbody>` +
      `<tfoot><tr data-if="discount_total"><td colspan="2">Discount</td><td>d</td></tr><tr><td colspan="2">Total</td><td>t</td></tr></tfoot></table>`),
    `.t { width: 100%; }`);
  const shown = cellWidths(gst);
  const hidden = cellWidths(gst, { ...SAMPLE_INVOICE, hide_gst_column: true, discount_total: "0" });
  const hiddenText = renderedText(gst).length - texts(layoutPage(gst, { ...SAMPLE_INVOICE, hide_gst_column: true }).element).length;
  check("a hidden column drops its cells, shrinks spans over it, and frees its width",
    shown.length === 3 + 4 * 3 + 2 * 2 && hidden.length === 2 + 4 * 2 + 2 && hiddenText === 1 + 4 &&
      close(hidden.slice(0, 2).reduce((a, b) => a + b, 0), inner) && close(hidden[hidden.length - 2], hidden[0]),
    `shown=${shown.length} hidden=${hidden.length} hiddenText=${hiddenText}`);
}

async function seedRenders(): Promise<void> {
  console.log("\nseed templates, rendered as a publish would");
  const expectedHeight = Math.round((THUMBNAIL_WIDTH * PAGE_SIZES.A4.height) / PAGE_SIZES.A4.width);
  for (const t of SEED_TEMPLATES) {
    try {
      const { compiled } = compileTemplate(t.html, t.css);
      const bytes = await Promise.all([0, 1].map(async () =>
        compressPageThumbnail(await renderThumbnailPng(compiled, THUMBNAIL_WIDTH), THUMBNAIL_WIDTH)));
      const [a, b] = bytes.map((buf) => crypto.createHash("sha256").update(buf).digest("hex"));
      const meta = await sharp(bytes[0]).metadata();
      const kb = bytes[0].length / 1024;
      const problems = [
        meta.format !== "webp" && `format ${meta.format}`,
        meta.width !== THUMBNAIL_WIDTH && `width ${meta.width}`,
        meta.height !== expectedHeight && `height ${meta.height} (want ${expectedHeight})`,
        meta.hasAlpha && "has an alpha channel",
        kb >= 100 && `${kb.toFixed(0)} KB`,
        a !== b && "two renders differ",
      ].filter(Boolean);
      check(`${t.id.padEnd(9)} ${meta.width}x${meta.height} webp, ${kb.toFixed(1)} KB, deterministic (${a.slice(0, 12)}…)`,
        problems.length === 0, problems.join(", "));
    } catch (e) {
      check(t.id, false, (e as Error).message);
    }
  }
}

(async () => {
  await layoutRules();
  await seedRenders();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})();

