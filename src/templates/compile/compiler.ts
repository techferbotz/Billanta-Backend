import { createHash } from "node:crypto";
import {
  CompiledTemplate,
  COMPILER_VERSION,
  SCHEMA_VERSION,
  ResolvedStyle,
  TemplateNode,
  BoxNode,
  TextNode,
  RowNode,
  CellNode,
  TableNode,
  TableBody,
  TableColumn,
  ImageNode,
  Value,
  Span,
  PageMargin,
  PageSetup,
} from "./nodes";
import { failAt, CompileError, ValueError } from "./errors";
import { AuthoredElement, AuthoredNode, parseHtml } from "../html/parser";
import { parseCss } from "../css/parser";
import { resolveStyles } from "../css/cascade";
import { PROPERTY_ORDER } from "../css/properties";
import {
  parseTextToSpans,
  parseSingleBinding,
  parseRepeatExpression,
  validatePath,
} from "./bindings";

// The compiler: authored HTML + CSS -> Billanta Template JSON. It parses both inputs,
// resolves one absolute style per element (the cascade), then walks the tree emitting typed
// nodes with bindings extracted. Output is deterministic: no clock/random, fixed key order,
// and a sha256 checksum over the canonical JSON.

// Tags whose content is a block container.
const CONTAINER_TAGS = new Set(["div", "ul", "ol"]);
// Tags that are inline (contribute to a text node's spans rather than their own node).
const INLINE_TAGS = new Set(["span", "strong", "em", "br"]);
// Tags that force an ancestor text-bearing element to become a box.
const BLOCK_CHILD_TAGS = new Set([
  "div", "table", "img", "hr", "ul", "ol", "p",
  "h1", "h2", "h3", "h4", "h5", "h6", "li",
  "thead", "tbody", "tfoot", "tr", "td", "th",
]);
// Style keys that make sense on an inline span (text appearance only).
const INLINE_SPAN_KEYS = [
  "color", "backgroundColor", "fontFamily", "fontSize",
  "fontWeight", "fontStyle", "letterSpacing", "textTransform",
];

const DEFAULT_MARGIN = 36; // pt, ~0.5in
const DEFAULT_FONT_FAMILY = "Inter";
const DEFAULT_FONT_SIZE = 11; // pt
// A table can't sanely span more columns than this; the cap also bounds deriveColumns' loop
// so an attacker-controlled colspan can never cause an OOM/hang.
const MAX_COLSPAN = 64;

export interface CompileResult {
  compiled: CompiledTemplate;
  checksum: string;
  compilerVersion: number;
}

// One compile run. Holds the resolved-style map and the insideRepeat flag so the tree walk
// can stay a set of small methods.
class Compiler {
  private readonly styles: Map<AuthoredElement, ResolvedStyle>;

  constructor(private readonly root: AuthoredElement, rules: ReturnType<typeof parseCss>) {
    this.styles = resolveStyles(root, rules);
  }

  private styleOf(el: AuthoredElement): ResolvedStyle {
    return this.styles.get(el) ?? {};
  }

  private hasBlockChild(el: AuthoredElement): boolean {
    return el.children.some((c) => c.type === "element" && BLOCK_CHILD_TAGS.has(c.tag));
  }

  // --- inline spans -----------------------------------------------------------------
  private filterInline(style: ResolvedStyle): ResolvedStyle {
    const out: ResolvedStyle = {};
    for (const key of INLINE_SPAN_KEYS) if (key in style) out[key] = style[key];
    return out;
  }

  // Collect spans from an inline node (text / span / strong / em / br), merging inline style.
  private collectSpans(node: AuthoredNode, parentInline: ResolvedStyle): Span[] {
    if (node.type === "text") {
      const spans = this.wrapText(node.text, node.line);
      if (Object.keys(parentInline).length === 0) return spans;
      return spans.map((s) => ({ ...s, style: orderStyle({ ...parentInline, ...(s.style ?? {}) }) }));
    }

    // element
    if (node.tag === "br") {
      return [{ value: { kind: "literal", text: "\n" }, ...objIf(orderStyle(parentInline)) }];
    }

    // span / strong / em: compute this element's inline style contribution.
    const own = this.filterInline(this.styleOf(node));
    if (node.tag === "strong" && !("fontWeight" in own)) own.fontWeight = 700;
    if (node.tag === "em" && !("fontStyle" in own)) own.fontStyle = "italic";
    const merged = { ...parentInline, ...own };

    const spans: Span[] = [];
    for (const child of node.children) {
      if (child.type === "text" || INLINE_TAGS.has(child.tag)) {
        spans.push(...this.collectSpans(child, merged));
      } else {
        // A block element inside inline context is unusual; reject clearly.
        failAt("structure", `<${child.tag}> is not allowed inside <${node.tag}>`, child.line);
      }
    }
    return spans;
  }

  private wrapText(text: string, line?: number): Span[] {
    try {
      return parseTextToSpans(text);
    } catch (err) {
      if (err instanceof ValueError) failAt("binding", err.message, line);
      throw err;
    }
  }

  // Build a text node from a run of inline authored nodes owned by `owner`.
  //
  // Returns null when there's nothing significant to render — in particular for the whitespace
  // BETWEEN block elements (newlines/indentation in the source), which HTML treats as
  // insignificant. A run counts as significant if any span is a binding or a non-whitespace
  // literal; a run of only collapsed whitespace is dropped rather than emitted as a stray " "
  // text node (which would bloat every template's tree).
  private buildTextNode(nodes: AuthoredNode[], owner: AuthoredElement): TextNode | null {
    const spans: Span[] = [];
    for (const n of nodes) spans.push(...this.collectSpans(n, {}));

    const significant = spans.some(
      (s) => s.value.kind === "bind" || s.value.text.trim().length > 0
    );
    if (!significant) return null;

    return { type: "text", style: this.styleOf(owner), spans };
  }

  // Compile a run of block-level children, grouping inline content into text nodes.
  private compileBlockChildren(owner: AuthoredElement, insideRepeat: boolean): TemplateNode[] {
    const out: TemplateNode[] = [];
    let buffer: AuthoredNode[] = [];
    const flush = (): void => {
      if (buffer.length === 0) return;
      const text = this.buildTextNode(buffer, owner);
      if (text) out.push(text);
      buffer = [];
    };

    for (const child of owner.children) {
      if (child.type === "text" || INLINE_TAGS.has(child.tag)) {
        buffer.push(child);
      } else {
        flush();
        out.push(this.compileWithWrappers(child as AuthoredElement, insideRepeat));
      }
    }
    flush();
    return out;
  }

  // --- element compilation ----------------------------------------------------------
  // Compile an element, then wrap it in repeat/conditional per its data-* attributes.
  private compileWithWrappers(el: AuthoredElement, insideRepeat: boolean): TemplateNode {
    const repeatAttr = el.attrs.get("data-repeat");
    const ifAttr = el.attrs.get("data-if");

    let node = this.compileElement(el, insideRepeat || repeatAttr !== undefined);

    if (repeatAttr !== undefined) {
      const rb = this.parseRepeat(repeatAttr, el.line);
      node = { type: "repeat", path: rb.path, as: rb.as, child: node };
    }
    if (ifAttr !== undefined) {
      node = { type: "conditional", path: this.parsePath(ifAttr, el.line), child: node };
    }
    return node;
  }

  private compileElement(el: AuthoredElement, insideRepeat: boolean): TemplateNode {
    const style = this.styleOf(el);

    switch (el.tag) {
      case "img":
        return this.compileImage(el, style);
      case "hr":
        return { type: "divider", style };
      case "table":
        return this.compileTable(el, insideRepeat);
      case "ol":
        // Static numbering can't be correct if the list is (or is inside) a data-repeat.
        if (insideRepeat) {
          failAt("structure", "<ol> cannot be used inside a data-repeat (numbering can't be static)", el.line);
        }
        return this.compileList(el, insideRepeat, true);
      case "ul":
        return this.compileList(el, insideRepeat, false);
      case "div":
        return { type: "box", style, children: this.compileBlockChildren(el, insideRepeat) };
      default:
        // Text-bearing: p, h1-h6, li, td, th, span, strong, em used as a block child.
        return this.compileTextOrBox(el, insideRepeat);
    }
  }

  private compileTextOrBox(el: AuthoredElement, insideRepeat: boolean): TemplateNode {
    const style = this.styleOf(el);
    if (this.hasBlockChild(el)) {
      return { type: "box", style, children: this.compileBlockChildren(el, insideRepeat) };
    }
    const text = this.buildTextNode(el.children, el);
    // An empty text-bearing element becomes an empty box, so it can still show a border/bg.
    return text ?? { type: "box", style, children: [] };
  }

  private compileImage(el: AuthoredElement, style: ResolvedStyle): ImageNode {
    const src = el.attrs.get("src");
    if (!src) failAt("html", "<img> requires a src binding like {{ company.logo }}", el.line);
    let source: Value;
    try {
      source = parseSingleBinding(src as string);
    } catch (err) {
      if (err instanceof ValueError) failAt("binding", err.message, el.line);
      throw err;
    }
    // A fallback on an image source would become the EFFECTIVE image URL when the bound path
    // is empty — an external-resource smuggling vector (tracking pixel / data: payload) that
    // bypasses the "img src must be a binding, no external URLs" rule. Forbid it outright.
    if (source.kind === "bind" && source.fallback !== "") {
      failAt("binding", "an <img> source binding may not have a `?? fallback` (it would become an external image URL)", el.line);
    }
    const fit: "contain" | "cover" = el.attrs.get("data-fit") === "cover" ? "cover" : "contain";
    return { type: "image", style, source, fit };
  }

  // ul/ol -> box of item boxes. For ol, prepend a static "N. " literal to each item's text.
  private compileList(el: AuthoredElement, insideRepeat: boolean, ordered: boolean): BoxNode {
    const style = this.styleOf(el);
    const children: TemplateNode[] = [];
    let index = 0;
    for (const child of el.children) {
      if (child.type !== "element") {
        // Ignore whitespace text between <li>s; reject any other stray text.
        if (child.text.trim().length === 0) continue;
        failAt("structure", `<${el.tag}> may only contain <li> elements`, child.line);
        continue; // unreachable; failAt throws
      }
      if (child.tag !== "li") {
        failAt("structure", `<${el.tag}> may only contain <li> elements`, child.line);
      }
      index += 1;
      const item = this.compileElement(child, insideRepeat);
      if (ordered) this.prependMarker(item, `${index}. `);
      children.push(item);
    }
    return { type: "box", style, children };
  }

  // Prepend a literal marker span to a compiled list item (text node), for <ol> numbering.
  private prependMarker(node: TemplateNode, marker: string): void {
    if (node.type === "text") {
      node.spans.unshift({ value: { kind: "literal", text: marker } });
    }
    // If the item compiled to a box (block content), numbering is dropped — the item is not
    // a simple text line, so a leading number would be ambiguous.
  }

  // --- tables -----------------------------------------------------------------------
  private compileTable(el: AuthoredElement, insideRepeat: boolean): TableNode {
    const style = this.styleOf(el);
    const sections = { thead: [] as AuthoredElement[], tbody: [] as AuthoredElement[], tfoot: [] as AuthoredElement[] };
    const looseRows: AuthoredElement[] = [];

    for (const child of el.children) {
      if (child.type !== "element") continue;
      if (child.tag === "thead") sections.thead.push(...this.rowsOf(child));
      else if (child.tag === "tbody") sections.tbody.push(...this.rowsOf(child));
      else if (child.tag === "tfoot") sections.tfoot.push(...this.rowsOf(child));
      else if (child.tag === "tr") looseRows.push(child);
      else failAt("structure", `<${child.tag}> is not allowed directly in <table>`, child.line);
    }
    // A table with bare <tr>s (no sections) treats them as the body.
    if (looseRows.length) sections.tbody.push(...looseRows);

    const header = sections.thead.map((tr) => this.compileRow(tr, insideRepeat));
    const footer = sections.tfoot.map((tr) => this.compileRow(tr, insideRepeat));
    const body = this.compileTableBody(sections.tbody, insideRepeat);
    const columns = this.deriveColumns(header, body, footer);

    return { type: "table", style, columns, header, body, footer };
  }

  private rowsOf(section: AuthoredElement): AuthoredElement[] {
    const rows: AuthoredElement[] = [];
    for (const child of section.children) {
      if (child.type !== "element") continue;
      if (child.tag === "tr") rows.push(child);
      else failAt("structure", `<${child.tag}> is not allowed in <${section.tag}>`, child.line);
    }
    return rows;
  }

  private compileTableBody(trs: AuthoredElement[], insideRepeat: boolean): TableBody {
    const repeatRows = trs.filter((tr) => tr.attrs.get("data-repeat") !== undefined);
    if (repeatRows.length > 1) {
      failAt("structure", "a table body may have at most one data-repeat row", repeatRows[1].line);
    }
    if (repeatRows.length === 1) {
      if (trs.length > 1) {
        failAt(
          "structure",
          "a table body with a data-repeat row cannot also contain static rows",
          trs.find((t) => t !== repeatRows[0])!.line
        );
      }
      const tr = repeatRows[0];
      const rb = this.parseRepeat(tr.attrs.get("data-repeat") as string, tr.line);
      return { repeat: rb, row: this.compileRow(tr, true) };
    }
    return { rows: trs.map((tr) => this.compileRow(tr, insideRepeat)) };
  }

  private compileRow(tr: AuthoredElement, insideRepeat: boolean): RowNode {
    const style = this.styleOf(tr);
    const cells: CellNode[] = [];
    for (const child of tr.children) {
      if (child.type !== "element") continue;
      if (child.tag !== "td" && child.tag !== "th") {
        failAt("structure", `<${child.tag}> is not allowed in <tr>`, child.line);
      }
      cells.push(this.compileCell(child, insideRepeat));
    }
    return { type: "row", style, cells };
  }

  private compileCell(cell: AuthoredElement, insideRepeat: boolean): CellNode {
    const style = this.styleOf(cell);
    const colSpan = this.parseColSpan(cell);
    const children = this.hasBlockChild(cell)
      ? this.compileBlockChildren(cell, insideRepeat)
      : this.childrenOfText(cell);
    return { type: "cell", style, colSpan, children };
  }

  private childrenOfText(el: AuthoredElement): TemplateNode[] {
    const text = this.buildTextNode(el.children, el);
    return text ? [text] : [];
  }

  private parseColSpan(cell: AuthoredElement): number {
    const raw = cell.attrs.get("colspan");
    if (!raw) return 1;
    // Match plain digits only (so "1e21", "0x10", "  9 " etc. are rejected) and bound the
    // value — an unbounded colspan feeds deriveColumns' loop and would OOM/hang the compile.
    if (!/^\d+$/.test(raw.trim())) {
      failAt("html", `invalid colspan "${raw}"`, cell.line);
    }
    const n = Number(raw.trim());
    if (n < 1 || n > MAX_COLSPAN) {
      failAt("html", `colspan must be between 1 and ${MAX_COLSPAN} (got "${raw}")`, cell.line);
    }
    return n;
  }

  // Derive column widths from the first available row. Width comes from each leading cell's
  // resolved `width` when it's an absolute number of points; otherwise "auto".
  private deriveColumns(header: RowNode[], body: TableBody, footer: RowNode[]): TableColumn[] {
    const sample =
      header[0] ?? body.row ?? (body.rows && body.rows[0]) ?? footer[0] ?? null;
    if (!sample) return [];
    const columns: TableColumn[] = [];
    for (const cell of sample.cells) {
      const w = cell.style.width;
      const width: number | "auto" = typeof w === "number" ? w : "auto";
      for (let i = 0; i < cell.colSpan; i++) columns.push({ width });
    }
    return columns;
  }

  // --- data-* expression parsing (located) ------------------------------------------
  private parseRepeat(raw: string, line?: number) {
    try {
      return parseRepeatExpression(raw);
    } catch (err) {
      if (err instanceof ValueError) failAt("binding", err.message, line);
      throw err;
    }
  }

  private parsePath(raw: string, line?: number): string {
    try {
      return validatePath(raw);
    } catch (err) {
      if (err instanceof ValueError) failAt("binding", err.message, line);
      throw err;
    }
  }

  // --- page setup -------------------------------------------------------------------
  private buildPage(rootStyle: ResolvedStyle): PageSetup {
    const sizeAttr = this.root.attrs.get("data-page-size");
    if (sizeAttr && sizeAttr.toUpperCase() !== "A4") {
      failAt("structure", `unsupported page size "${sizeAttr}" (only A4)`, this.root.line);
    }
    const margin: PageMargin = {
      top: num(rootStyle.paddingTop, DEFAULT_MARGIN),
      right: num(rootStyle.paddingRight, DEFAULT_MARGIN),
      bottom: num(rootStyle.paddingBottom, DEFAULT_MARGIN),
      left: num(rootStyle.paddingLeft, DEFAULT_MARGIN),
    };
    return {
      size: "A4",
      margin,
      fontFamily: typeof rootStyle.fontFamily === "string" ? rootStyle.fontFamily : DEFAULT_FONT_FAMILY,
      baseFontSize: num(rootStyle.fontSize, DEFAULT_FONT_SIZE),
    };
  }

  compile(): CompileResult {
    const rootStyle = this.styleOf(this.root);
    const page = this.buildPage(rootStyle);

    // Compile the root as a box; strip its padding, which became the page margin (so it isn't
    // applied twice). The root itself is never a repeat/conditional target.
    const rootNode = this.compileElement(this.root, false) as BoxNode | TextNode;
    stripPadding(rootNode.style);

    const compiled: CompiledTemplate = {
      schemaVersion: SCHEMA_VERSION,
      compilerVersion: COMPILER_VERSION,
      page,
      root: rootNode,
    };
    const checksum = createHash("sha256").update(JSON.stringify(compiled)).digest("hex");
    return { compiled, checksum, compilerVersion: COMPILER_VERSION };
  }
}

// A span spread helper: attach `style` only when non-empty (keeps output minimal/deterministic).
const objIf = (style: ResolvedStyle): { style?: ResolvedStyle } =>
  Object.keys(style).length ? { style } : {};

const num = (v: unknown, fallback: number): number => (typeof v === "number" ? v : fallback);

// Rebuild a style object with keys in the canonical PROPERTY_ORDER, so equivalent inline
// styling always serializes to identical bytes (same determinism guarantee as node styles).
const orderStyle = (style: ResolvedStyle): ResolvedStyle => {
  const out: ResolvedStyle = {};
  for (const key of PROPERTY_ORDER) if (key in style) out[key] = style[key];
  return out;
};

const stripPadding = (style: ResolvedStyle): void => {
  delete style.paddingTop;
  delete style.paddingRight;
  delete style.paddingBottom;
  delete style.paddingLeft;
};

/**
 * Compile authored HTML + CSS into Billanta Template JSON.
 *
 * Throws CompileError (with an exact location) for any authoring mistake — the caller turns
 * that into a 400 carrying the message. Deterministic: the same inputs always yield the same
 * `compiled` and `checksum`.
 */
export const compileTemplate = (html: string, css: string): CompileResult => {
  const root = parseHtml(html);
  const rules = parseCss(css);
  return new Compiler(root, rules).compile();
};

export { CompileError };
