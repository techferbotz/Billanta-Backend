import {
  BoxNode,
  CellNode,
  CompiledTemplate,
  ImageNode,
  ResolvedStyle,
  RowNode,
  TableNode,
  TemplateNode,
  TextNode,
  Value,
  VisibleIf,
} from "../compile/nodes";
import { FieldDefinition } from "../../fields/types";
import { OPTION_LISTS } from "../../fields/optionLists";

// Lays a compiled Billanta Template JSON tree out against a dataset, producing the element tree
// satori rasterises (see rasterize.ts). PURE — no I/O, no dependencies — so it runs anywhere.
//
// It plays the part of the app's "dumb renderer" for the server's one use of rendering, the
// template-picker thumbnail (APP-012): bindings resolved, repeats expanded, conditionals gated,
// `editorOnly` nodes dropped (a thumbnail shows the EXPORTED invoice), and — the forward-
// compatibility rule — unknown node types and style keys ignored rather than fatal.
//
// It does not claim pixel identity with the app's renderer; APP-012 needs the same version at
// thumbnail scale, not the same pixels. Where the tree leaves a layout rule unstated it follows
// the source HTML/CSS the author previewed (see `text` and `table` below).

// A satori element, built as plain objects so this module needs no JSX runtime.
export interface Element {
  type: "div" | "span" | "img";
  props: {
    style: Style;
    children?: string | Element[];
    src?: string;
    width?: number;
    height?: number;
  };
}
type Style = Record<string, string | number>;

// The render context (docs/FIELDS.md §8.1): every field value by id, `line_items` as an array of
// line maps, and the computed totals.
export type RenderData = Record<string, unknown>;

// Page sizes in points. The layout works 1pt = 1 unit; rasterize.ts scales to pixels.
export const PAGE_SIZES: Record<string, { width: number; height: number }> = {
  A4: { width: 595, height: 842 },
};

export interface LaidOutPage {
  element: Element;
  width: number;
  height: number;
  fontFamilies: string[]; // the families the tree uses, so only those fonts are loaded
}

export function layoutPage(doc: CompiledTemplate, data: RenderData): LaidOutPage {
  const page = PAGE_SIZES[doc.page.size] ?? PAGE_SIZES.A4;
  const m = doc.page.margin;
  // The root element's padding is the page margin (the compiler moves it into page.margin).
  const inner = page.width - m.left - m.right;
  selects = selectLabelsOf(doc);
  const element = el("div", {
    display: "flex",
    flexDirection: "column",
    width: page.width,
    height: page.height,
    backgroundColor: "#ffffff",
    overflow: "hidden", // page 1 only: anything past the bottom edge is cropped
    paddingTop: m.top,
    paddingRight: m.right,
    paddingBottom: m.bottom,
    paddingLeft: m.left,
    fontFamily: doc.page.fontFamily,
    fontSize: doc.page.baseFontSize,
  }, renderNode(doc.root, data, inner, {}));
  return { element, width: page.width, height: page.height, fontFamilies: fontFamiliesIn(doc) };
}

// --- values ----------------------------------------------------------------------------

const lookup = (ctx: RenderData, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (o !== null && typeof o === "object" ? (o as RenderData)[k] : undefined), ctx);

// docs/FIELDS.md §6.2: absent, null, false, "", a decimal string equal to zero, an empty array or
// an empty object is falsy; everything else is truthy.
const truthy = (v: unknown): boolean => {
  if (v === undefined || v === null || v === false || v === "" || v === 0) return false;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return Number(v) !== 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
};

const shows = (cond: VisibleIf | undefined, ctx: RenderData): boolean =>
  !cond || truthy(lookup(ctx, cond.path)) !== (cond.negate === true);

// A select prints its option's label, not its value (docs/FIELDS.md §4.3). The labels come from
// the template's own field definitions: top-level fields by id, line-item columns by column id
// (for a two-segment path inside the repeat).
interface SelectLabels {
  fields: Map<string, Map<string, string>>;
  columns: Map<string, Map<string, string>>;
}
let selects: SelectLabels = { fields: new Map(), columns: new Map() };

function selectLabelsOf(doc: CompiledTemplate): SelectLabels {
  const labels = (f: FieldDefinition): Map<string, string> | undefined => {
    if (f.type !== "select" || !f.options || !f.id) return undefined;
    const options = typeof f.options === "string" ? OPTION_LISTS[f.options] ?? [] : f.options;
    return new Map(options.map((o) => [o.value, o.label]));
  };
  const out: SelectLabels = { fields: new Map(), columns: new Map() };
  for (const section of doc.sections ?? []) {
    for (const f of section.fields ?? []) {
      const top = labels(f);
      if (top) out.fields.set(f.id!, top);
      for (const c of f.columns ?? []) {
        const col = labels(c);
        if (col) out.columns.set(c.id!, col);
      }
    }
  }
  return out;
}

function selectLabel(path: string, raw: unknown): unknown {
  const segments = path.split(".");
  const map =
    segments.length === 1 ? selects.fields.get(segments[0]) : segments.length === 2 ? selects.columns.get(segments[1]) : undefined;
  return map?.get(String(raw)) ?? raw;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Integer paise -> "₹2,56,886.00" with Indian digit grouping. Hand-rolled rather than Intl so the
// output can't drift with the ICU data a given Node build ships (thumbnails must be deterministic).
function formatInr(paise: unknown): string {
  let a = BigInt(String(paise));
  const negative = a < 0n;
  if (negative) a = -a;
  const rupees = (a / 100n).toString();
  const fraction = (a % 100n).toString().padStart(2, "0");
  let head = rupees.slice(0, -3);
  const tail = rupees.slice(-3);
  if (head) head = head.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + ",";
  return `${negative ? "-" : ""}₹${head}${tail}.${fraction}`;
}

function format(raw: unknown, hint: string): string {
  switch (hint) {
    case "currency":
      return formatInr(raw);
    case "date": {
      const [y, mo, d] = String(raw).split("-");
      return `${d} ${MONTHS[Number(mo) - 1]} ${y}`;
    }
    case "number": {
      const n = Number(raw);
      return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "");
    }
    default:
      return String(raw);
  }
}

function valueOf(v: Value | undefined, ctx: RenderData): string {
  if (!v) return "";
  if (v.kind === "literal") return v.text;
  if (v.kind === "bind") {
    const raw = lookup(ctx, v.path);
    const s = raw === undefined || raw === null || raw === "" ? "" : format(selectLabel(v.path, raw), v.format);
    return s === "" ? v.fallback : s;
  }
  return ""; // an unknown value kind renders nothing (forward-compat)
}

// --- styles ----------------------------------------------------------------------------

// Style keys that mean the same thing to satori as they do in the tree.
const PASSTHROUGH = new Set([
  "flexDirection", "justifyContent", "alignItems", "flexWrap", "gap",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "marginTop", "marginRight", "marginBottom", "marginLeft",
  "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "borderTopStyle", "borderRightStyle", "borderBottomStyle", "borderLeftStyle",
  "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "borderRadius",
  "backgroundColor", "color", "fontSize", "fontWeight", "fontStyle", "fontFamily",
  "textAlign", "textTransform", "letterSpacing", "overflow", "opacity",
]);

// Translate a resolved style. `display` is decided by the caller, `verticalAlign` by table cells;
// any key not listed is ignored — the forward-compatibility rule.
function css(style: ResolvedStyle | undefined): Style {
  const out: Style = {};
  for (const [key, value] of Object.entries(style ?? {})) {
    if (PASSTHROUGH.has(key)) {
      out[key] = value;
    } else if (key === "lineHeight") {
      // a unitless multiplier, or an absolute value in points
      out.lineHeight = typeof value === "number" && value > 4 ? `${value}px` : value;
    } else if (key === "flex") {
      const [grow, shrink, basis] = String(value).split(/\s+/);
      out.flexGrow = Number(grow);
      out.flexShrink = shrink === undefined ? 1 : Number(shrink);
      out.flexBasis = basis === undefined ? 0 : basis;
    }
  }
  return out;
}

const el = (type: Element["type"], style: Style, children?: string | Element[], extra?: Partial<Element["props"]>): Element =>
  ({ type, props: { style, children, ...extra } });

// --- widths ----------------------------------------------------------------------------
// Tables fix their column widths once, in points, for every row — so a box has to know its width
// before its children are laid out. Tracked top-down: a percentage resolves against the parent.

const isPercent = (v: unknown): v is string => typeof v === "string" && v.endsWith("%");

function resolveWidth(w: unknown, available: number): number {
  if (typeof w === "number") return w;
  if (isPercent(w)) return (available * parseFloat(w)) / 100;
  return available;
}

const num = (v: unknown): number => (typeof v === "number" ? v : 0);

function contentWidth(style: ResolvedStyle | undefined, outer: number): number {
  const s = style ?? {};
  return outer - num(s.paddingLeft) - num(s.paddingRight) - num(s.borderLeftWidth) - num(s.borderRightWidth);
}

// --- nodes -----------------------------------------------------------------------------

// `parent` is the style of the nearest box or cell above this node (see `text`).
function renderNode(n: TemplateNode, ctx: RenderData, available: number, parent: ResolvedStyle): Element[] {
  if (!n || typeof n !== "object") return [];
  if ((n as { editorOnly?: boolean }).editorOnly === true) return []; // never in an export
  switch (n.type) {
    case "box":
      return renderBox(n, ctx, available);
    case "text":
      return [renderText(n, ctx, parent)];
    case "image":
      return renderImage(n, ctx);
    case "divider":
      return [el("div", { ...css(n.style), display: "flex" }, [])];
    case "table":
      return [renderTable(n, ctx, available)];
    case "repeat": {
      const items = lookup(ctx, n.path);
      return (Array.isArray(items) ? items : []).flatMap((item) =>
        renderNode(n.child, { ...ctx, [n.as]: item }, available, parent));
    }
    case "conditional": {
      const on = truthy(lookup(ctx, n.path));
      return (n.negate ? !on : on) ? renderNode(n.child, ctx, available, parent) : [];
    }
    default:
      return []; // an unknown node type renders nothing (the forward-compatibility rule)
  }
}

function renderBox(n: BoxNode, ctx: RenderData, available: number): Element[] {
  const s = n.style ?? {};
  if (s.display === "none") return [];
  // satori has no block layout: a block box is a column, which stacks children the same way.
  const direction = s.display === "flex" ? String(s.flexDirection ?? "row") : "column";
  const outer = s.width !== undefined ? resolveWidth(s.width, available) : available;
  // Every child resolves its own width against this content box. (A width-less child of a row is
  // really narrower than this — only a table nested inside one would notice.)
  const inner = contentWidth(s, outer);
  const children = (n.children ?? []).flatMap((child) => renderNode(child, ctx, inner, s));
  return [el("div", { ...css(s), display: "flex", flexDirection: direction }, children)];
}

// The compiler stamps every text run with its OWNER element's full style. Two cases follow:
//  - a text-bearing tag with no block child (<p>, <h1>–<h6>, <li>, <span>, …) compiles to a text
//    node that IS the element: its padding, margin and border are its own and are drawn;
//  - a <div> always compiles to a box, and a <td>/<th> to a cell; their loose text becomes a child
//    text node carrying a COPY of the owner's style. Drawing those box styles again double-pads
//    every cell and nests a second border inside it, so such an anonymous run inherits only
//    typography — exactly what CSS gives an anonymous inline box.
// The copy is recognisable because it is the same style, value for value, as the parent's.
const INHERITED = ["color", "fontSize", "fontWeight", "fontStyle", "fontFamily", "lineHeight",
  "letterSpacing", "textTransform", "textAlign"];

const sameStyle = (a: ResolvedStyle | undefined, b: ResolvedStyle | undefined): boolean =>
  JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

// satori places a single-line run by its container's justifyContent and only applies textAlign to
// wrapped lines, so the alignment is mirrored onto the main axis.
const JUSTIFY: Record<string, string> = { right: "flex-end", center: "center" };

function renderText(n: TextNode, ctx: RenderData, parent: ResolvedStyle): Element {
  const own: ResolvedStyle = sameStyle(n.style, parent)
    ? Object.fromEntries(INHERITED.filter((k) => k in n.style).map((k) => [k, n.style[k]]))
    : n.style;

  // Adjacent spans that render identically merge into one run, which keeps a literal " " between
  // two bindings (satori collapses a lone-space run to nothing).
  const runs: { key: string; style: ResolvedStyle; text: string }[] = [];
  for (const span of n.spans ?? []) {
    const text = valueOf(span.value, ctx);
    if (text === "") continue;
    const style = span.style ?? {};
    const key = JSON.stringify(style);
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.text += text;
    else runs.push({ key, style, text });
  }

  const style: Style = {
    ...css(own),
    display: "flex",
    flexWrap: "wrap",
    justifyContent: JUSTIFY[String(own.textAlign)] ?? "flex-start",
  };
  if (runs.length <= 1) return el("div", style, runs[0]?.text ?? "");
  // Differently styled runs are separate flex items, which trim their edge spaces; pin them as
  // no-break spaces so "Mobile: " + "+91 …" keeps its gap.
  const pin = (t: string) => t.replace(/^ +| +$/g, (m) => " ".repeat(m.length));
  return el("div", style, runs.map((r) => el("span", css(r.style), pin(r.text))));
}

function renderImage(n: ImageNode, ctx: RenderData): Element[] {
  const src = valueOf(n.source, ctx);
  if (!src) return []; // an unbound image draws nothing, as in the app
  const s = css(n.style);
  return [el("img", { ...s, objectFit: n.fit === "cover" ? "cover" : "contain" }, undefined, {
    src,
    width: typeof s.width === "number" ? s.width : undefined,
    height: typeof s.height === "number" ? s.height : undefined,
  })];
}

// --- tables ----------------------------------------------------------------------------

// A row's cells with hidden columns taken out (docs/FIELDS.md §6.3): a cell's span shrinks by the
// hidden columns it covers, and a cell whose whole span is hidden is dropped. Cells past the end
// of `columns` (a row wider than the first) are kept as they are.
function visibleCells(row: RowNode, visible: boolean[]): { cell: CellNode; span: number }[] {
  const out: { cell: CellNode; span: number }[] = [];
  let c = 0;
  for (const cell of row.cells ?? []) {
    const span = Math.max(1, cell.colSpan || 1);
    let shown = 0;
    for (let i = c; i < c + span; i++) if (i >= visible.length || visible[i]) shown++;
    c += span;
    if (shown > 0) out.push({ cell, span: shown });
  }
  return out;
}

function renderTable(n: TableNode, ctx: RenderData, available: number): Element {
  const width = n.style?.width !== undefined ? resolveWidth(n.style.width, available) : available;
  const visible = (n.columns ?? []).map((col) => shows(col.visibleIf, ctx));

  // Every row that will render, paired with the data it binds against. A static row with a
  // `visibleIf` that's off is left out.
  const rows: { row: RowNode; ctx: RenderData }[] = [];
  const addStatic = (row: RowNode): void => {
    if (shows(row.visibleIf, ctx)) rows.push({ row, ctx });
  };
  (n.header ?? []).forEach(addStatic);
  if (n.body?.repeat && n.body.row) {
    const items = lookup(ctx, n.body.repeat.path);
    for (const item of Array.isArray(items) ? items : []) {
      rows.push({ row: n.body.row, ctx: { ...ctx, [n.body.repeat.as]: item } });
    }
  } else {
    (n.body?.rows ?? []).forEach(addStatic);
  }
  (n.footer ?? []).forEach(addStatic);

  const laid = rows.map(({ row, ctx: rowCtx }) => ({ row, ctx: rowCtx, cells: visibleCells(row, visible) }));
  const columns = Math.max(1, ...laid.map((r) => r.cells.reduce((a, c) => a + c.span, 0)));

  // Column widths, in points, fixed once so every row's borders line up — including a footer cell
  // that spans columns. The tree's `columns` are "auto" in practice; the author's widths live on the
  // cells' own styles. An explicit width on a single-column cell fixes that column; the rest share
  // what's left in proportion to an estimate of their widest content (text plus the cell's padding
  // and borders), which is how a browser's automatic table layout distributes it.
  const fixed: (number | null)[] = new Array(columns).fill(null);
  const want: number[] = new Array(columns).fill(1);
  for (const { cells, ctx: rowCtx } of laid) {
    let c = 0;
    for (const { cell, span } of cells) {
      if (span === 1 && c < columns) {
        const s = cell.style ?? {};
        if (s.width !== undefined && fixed[c] === null) fixed[c] = resolveWidth(s.width, width);
        const estimate = longestText(cell, rowCtx) * num(s.fontSize || 9) * 0.55 +
          num(s.paddingLeft) + num(s.paddingRight) + num(s.borderLeftWidth) + num(s.borderRightWidth);
        want[c] = Math.max(want[c], estimate);
      }
      c += span;
    }
  }
  const fixedTotal = fixed.reduce<number>((a, w) => a + (w ?? 0), 0);
  const autoTotal = want.reduce((a, w, i) => a + (fixed[i] === null ? w : 0), 0);
  const columnWidth = fixed.map((w, i) =>
    w !== null ? w : autoTotal > 0 ? ((width - fixedTotal) * want[i]) / autoTotal : 0);

  const rowElements = laid.map(({ row, cells: shown, ctx: rowCtx }) => {
    let c = 0;
    const cells = shown.map(({ cell, span }) => {
      const w = columnWidth.slice(c, c + span).reduce((a, b) => a + b, 0);
      c += span;
      return renderCell(cell, rowCtx, w);
    });
    // stretch: every cell in a row is as tall as the tallest, like a table row
    return el("div", { ...css(row.style), display: "flex", flexDirection: "row", alignItems: "stretch" }, cells);
  });
  return el("div", { ...css(n.style), display: "flex", flexDirection: "column", width }, rowElements);
}

function renderCell(cell: CellNode, ctx: RenderData, width: number): Element {
  const s = cell.style ?? {};
  // a table cell's default vertical alignment is middle
  const vertical = s.verticalAlign === "top" ? "flex-start" : s.verticalAlign === "bottom" ? "flex-end" : "center";
  const { width: _ignored, ...style } = css(s);
  const children = (cell.children ?? []).flatMap((child) => renderNode(child, ctx, contentWidth(s, width), s));
  return el("div", {
    ...style,
    display: "flex",
    flexDirection: "column",
    justifyContent: vertical,
    width,
    flexShrink: 0,
  }, children);
}

// The longest resolved text anywhere inside a node — the input to the column-width estimate.
function longestText(n: TemplateNode, ctx: RenderData): number {
  let longest = 0;
  const walk = (x: TemplateNode | undefined): void => {
    if (!x || typeof x !== "object") return;
    if (x.type === "text") {
      longest = Math.max(longest, x.spans.map((s) => valueOf(s.value, ctx)).join("").length);
    }
    if ("children" in x && Array.isArray(x.children)) x.children.forEach(walk);
    if ("child" in x) walk(x.child);
  };
  walk(n);
  return longest;
}

// Every font family the tree names, plus the page default.
function fontFamiliesIn(doc: CompiledTemplate): string[] {
  const families = new Set<string>([doc.page.fontFamily]);
  const visit = (style: ResolvedStyle | undefined) => {
    if (style && typeof style.fontFamily === "string") families.add(style.fontFamily);
  };
  const walk = (x: unknown): void => {
    if (!x || typeof x !== "object") return;
    const n = x as Record<string, unknown>;
    visit(n.style as ResolvedStyle | undefined);
    for (const span of (n.spans as { style?: ResolvedStyle }[] | undefined) ?? []) visit(span.style);
    for (const key of ["children", "cells", "header", "footer"]) {
      for (const child of (n[key] as unknown[] | undefined) ?? []) walk(child);
    }
    walk(n.child);
    const body = n.body as { row?: unknown; rows?: unknown[] } | undefined;
    if (body) { walk(body.row); (body.rows ?? []).forEach(walk); }
  };
  walk(doc.root);
  return [...families].sort();
}
