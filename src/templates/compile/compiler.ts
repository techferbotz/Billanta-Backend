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
  Theme,
  ThemeToken,
  SectionDef,
  CustomisationControl,
  VisibleIf,
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
import { COMPUTED_IDS, FIELD_ID_PATTERN, LINE_COMPUTED_IDS, fieldSpec } from "../../fields/registry";
import { FieldError, resolveField } from "../../fields/resolve";
import { formField } from "../../fields/forms";
import { FieldDefinition, FieldType } from "../../fields/types";

// The compiler: authored HTML + CSS -> Billanta Template JSON. It parses both inputs,
// resolves one absolute style per element (the cascade), then walks the tree emitting typed
// nodes with bindings extracted. Output is deterministic: no clock/random, fixed key order,
// and a sha256 checksum over the canonical JSON.
//
// Since compiler v2 (docs/FIELDS.md §6) a template also declares, per section, the fields its
// editor shows. The walk records every path the template prints or tests; once it finishes, each
// is checked against those field lists, so everything on the page can be edited and a typo fails
// the publish instead of printing blank.

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
// Table parts that are neither rows nor cells: no data-* behaviour attaches to them.
const TABLE_SECTION_TAGS = new Set(["thead", "tbody", "tfoot"]);

const DEFAULT_MARGIN = 36; // pt, ~0.5in
const DEFAULT_FONT_FAMILY = "Inter";
const DEFAULT_FONT_SIZE = 11; // pt
// A table can't sanely span more columns than this; the cap also bounds deriveColumns' loop
// so an attacker-controlled colspan can never cause an OOM/hang.
const MAX_COLSPAN = 64;
// The one list a template may repeat over (docs/FIELDS.md §6.2).
const REPEATABLE = "line_items";
const MAX_FIELDS_PER_SECTION = 64;
const MAX_SECTION_LABEL = 120;

// Human labels for the colour tokens users recognise; any other token name gets a capitalised
// fallback so an author can invent a token without editing the compiler.
const TOKEN_LABELS: Record<string, string> = {
  accent: "Accent",
  ink: "Text",
  muted: "Secondary text",
};

const capitalize = (s: string): string => (s.length ? s[0].toUpperCase() + s.slice(1) : s);
const humanize = (id: string): string => capitalize(id.replace(/_/g, " "));

// A node's token map with keys in a fixed (sorted) order, so equivalent tagging serializes to
// identical bytes regardless of author order or how the map was assembled.
const orderTokens = (map: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const key of Object.keys(map).sort()) out[key] = map[key];
  return out;
};

export interface CompileResult {
  compiled: CompiledTemplate;
  checksum: string;
  compilerVersion: number;
}

// How a path is used, which decides what it may resolve to.
type PathUse = "print" | "test" | "image" | "repeat";

interface PathRecord {
  path: string;
  use: PathUse;
  scope: string | null; // the data-repeat alias in force, if any
  line?: number;
}

// One section's declaration (data-section-label / data-hidable / data-fields on one element).
interface SectionDecl {
  label: string;
  hidable: boolean;
  fields: FieldDefinition[];
  line?: number;
}

// One compile run. Holds the resolved-style map and the collectors the tree walk fills, so the
// walk can stay a set of small methods.
class Compiler {
  private readonly styles: Map<AuthoredElement, ResolvedStyle>;
  // Template-customisation collectors, filled by tagNode during the tree walk (APP-003). A Map and
  // a Set both preserve first-occurrence order, so buildTheme/buildSections stay deterministic.
  private readonly themeTokens = new Map<string, string>(); // token name -> default hex
  private readonly sectionsUsed = new Set<string>();
  private readonly sectionDecls = new Map<string, SectionDecl>();
  private readonly paths: PathRecord[] = [];

  constructor(private readonly root: AuthoredElement, rules: ReturnType<typeof parseCss>) {
    this.styles = resolveStyles(root, rules);
  }

  private styleOf(el: AuthoredElement): ResolvedStyle {
    return this.styles.get(el) ?? {};
  }

  private hasBlockChild(el: AuthoredElement): boolean {
    return el.children.some((c) => c.type === "element" && BLOCK_CHILD_TAGS.has(c.tag));
  }

  private record(path: string, use: PathUse, scope: string | null, line?: number): void {
    this.paths.push({ path, use, scope, line });
  }

  // --- inline spans -----------------------------------------------------------------
  private filterInline(style: ResolvedStyle): ResolvedStyle {
    const out: ResolvedStyle = {};
    for (const key of INLINE_SPAN_KEYS) if (key in style) out[key] = style[key];
    return out;
  }

  // Collect spans from an inline node (text / span / strong / em / br), merging inline style.
  private collectSpans(node: AuthoredNode, parentInline: ResolvedStyle, scope: string | null): Span[] {
    if (node.type === "text") {
      const spans = this.wrapText(node.text, node.line);
      for (const s of spans) {
        if (s.value.kind === "bind") this.record(s.value.path, "print", scope, node.line);
      }
      if (Object.keys(parentInline).length === 0) return spans;
      return spans.map((s) => ({ ...s, style: orderStyle({ ...parentInline, ...(s.style ?? {}) }) }));
    }

    // element
    this.rejectDataAttrs(node, ["data-if", "data-unless", "data-repeat"], "an inline element");
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
        spans.push(...this.collectSpans(child, merged, scope));
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
  private buildTextNode(nodes: AuthoredNode[], owner: AuthoredElement, scope: string | null): TextNode | null {
    const spans: Span[] = [];
    for (const n of nodes) spans.push(...this.collectSpans(n, {}, scope));

    const significant = spans.some(
      (s) => s.value.kind === "bind" || s.value.text.trim().length > 0
    );
    if (!significant) return null;

    return { type: "text", style: this.styleOf(owner), spans };
  }

  // Compile a run of block-level children, grouping inline content into text nodes.
  private compileBlockChildren(owner: AuthoredElement, scope: string | null): TemplateNode[] {
    const out: TemplateNode[] = [];
    let buffer: AuthoredNode[] = [];
    const flush = (): void => {
      if (buffer.length === 0) return;
      const text = this.buildTextNode(buffer, owner, scope);
      if (text) out.push(text);
      buffer = [];
    };

    for (const child of owner.children) {
      if (child.type === "text" || INLINE_TAGS.has(child.tag)) {
        buffer.push(child);
      } else {
        flush();
        out.push(this.compileWithWrappers(child as AuthoredElement, scope));
      }
    }
    flush();
    return out;
  }

  // --- element compilation ----------------------------------------------------------
  // Compile an element, then wrap it in repeat/conditional per its data-* attributes.
  private compileWithWrappers(el: AuthoredElement, scope: string | null): TemplateNode {
    const repeatAttr = el.attrs.get("data-repeat");
    const condition = this.conditionOf(el, scope);

    let innerScope = scope;
    let repeat: { path: string; as: string } | undefined;
    if (repeatAttr !== undefined) {
      repeat = this.parseRepeat(repeatAttr, scope, el.line);
      innerScope = repeat.as;
    }

    let node = this.compileElement(el, innerScope);
    // Attach data-section / data-token / data-editor-only to the element's OWN node, before any
    // repeat/conditional wrapper (which carries no style or tags). [APP-003 / APP-008]
    if ("style" in node) this.tagNode(node, el);

    if (repeat) node = { type: "repeat", path: repeat.path, as: repeat.as, child: node };
    if (condition) {
      // data-unless is the same gate inverted: render only when the path is FALSY (APP-008).
      node = condition.negate
        ? { type: "conditional", path: condition.path, negate: true, child: node }
        : { type: "conditional", path: condition.path, child: node };
    }
    return node;
  }

  // An element's data-if / data-unless as a VisibleIf (recording the path as tested), or undefined.
  private conditionOf(el: AuthoredElement, scope: string | null): VisibleIf | undefined {
    const ifAttr = el.attrs.get("data-if");
    const unlessAttr = el.attrs.get("data-unless");
    if (ifAttr !== undefined && unlessAttr !== undefined) {
      failAt("structure", "an element cannot have both data-if and data-unless", el.line);
    }
    const raw = ifAttr ?? unlessAttr;
    if (raw === undefined) return undefined;
    const path = this.parsePath(raw, el.line);
    this.record(path, "test", scope, el.line);
    return unlessAttr !== undefined ? { path, negate: true } : { path };
  }

  private rejectDataAttrs(el: AuthoredElement, names: string[], where: string): void {
    for (const name of names) {
      if (el.attrs.has(name)) failAt("structure", `${name} isn't supported on ${where} (<${el.tag}>)`, el.line);
    }
  }

  private compileElement(el: AuthoredElement, scope: string | null): TemplateNode {
    const style = this.styleOf(el);

    switch (el.tag) {
      case "img":
        return this.compileImage(el, style, scope);
      case "hr":
        return { type: "divider", style };
      case "table":
        return this.compileTable(el, scope);
      case "ol":
        // Static numbering can't be correct if the list is (or is inside) a data-repeat.
        if (scope !== null) {
          failAt("structure", "<ol> cannot be used inside a data-repeat (numbering can't be static)", el.line);
        }
        return this.compileList(el, scope, true);
      case "ul":
        return this.compileList(el, scope, false);
      case "div":
        return { type: "box", style, children: this.compileBlockChildren(el, scope) };
      default:
        if (TABLE_SECTION_TAGS.has(el.tag) || el.tag === "tr" || el.tag === "td" || el.tag === "th") {
          failAt("structure", `<${el.tag}> is only allowed inside a <table>`, el.line);
        }
        // Text-bearing: p, h1-h6, li, span, strong, em used as a block child.
        return this.compileTextOrBox(el, scope);
    }
  }

  private compileTextOrBox(el: AuthoredElement, scope: string | null): TemplateNode {
    const style = this.styleOf(el);
    if (this.hasBlockChild(el)) {
      return { type: "box", style, children: this.compileBlockChildren(el, scope) };
    }
    const text = this.buildTextNode(el.children, el, scope);
    // An empty text-bearing element becomes an empty box, so it can still show a border/bg.
    return text ?? { type: "box", style, children: [] };
  }

  private compileImage(el: AuthoredElement, style: ResolvedStyle, scope: string | null): ImageNode {
    const src = el.attrs.get("src");
    if (!src) failAt("html", "<img> requires a src binding like {{ company_logo.url }}", el.line);
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
    if (source.kind === "bind") this.record(source.path, "image", scope, el.line);
    const fit: "contain" | "cover" = el.attrs.get("data-fit") === "cover" ? "cover" : "contain";
    return { type: "image", style, source, fit };
  }

  // ul/ol -> box of item boxes. For ol, prepend a static "N. " literal to each item's text.
  private compileList(el: AuthoredElement, scope: string | null, ordered: boolean): BoxNode {
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
      if (ordered) {
        // Numbering is static, so an <ol> item can't come and go.
        this.rejectDataAttrs(child, ["data-if", "data-unless", "data-repeat"], "an <ol> item");
        index += 1;
        const item = this.compileElement(child, scope);
        if ("style" in item) this.tagNode(item, child);
        this.prependMarker(item, `${index}. `);
        children.push(item);
      } else {
        children.push(this.compileWithWrappers(child, scope));
      }
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
  private compileTable(el: AuthoredElement, scope: string | null): TableNode {
    const style = this.styleOf(el);
    const sections = { thead: [] as AuthoredElement[], tbody: [] as AuthoredElement[], tfoot: [] as AuthoredElement[] };
    const looseRows: AuthoredElement[] = [];

    for (const child of el.children) {
      if (child.type !== "element") continue;
      if (TABLE_SECTION_TAGS.has(child.tag)) {
        this.rejectDataAttrs(child, ["data-if", "data-unless", "data-repeat"], "a table section");
      }
      if (child.tag === "thead") sections.thead.push(...this.rowsOf(child));
      else if (child.tag === "tbody") sections.tbody.push(...this.rowsOf(child));
      else if (child.tag === "tfoot") sections.tfoot.push(...this.rowsOf(child));
      else if (child.tag === "tr") looseRows.push(child);
      else failAt("structure", `<${child.tag}> is not allowed directly in <table>`, child.line);
    }
    // A table with bare <tr>s (no sections) treats them as the body.
    if (looseRows.length) sections.tbody.push(...looseRows);

    for (const tr of [...sections.thead, ...sections.tfoot]) {
      if (tr.attrs.has("data-repeat")) {
        failAt("structure", "data-repeat on a row is only allowed in the table body", tr.line);
      }
    }

    // Column conditions live on the cells of the FIRST row (the same row deriveColumns reads).
    const firstRow = sections.thead[0] ?? sections.tbody[0] ?? sections.tfoot[0];
    const columnConditions = firstRow ? this.columnConditions(firstRow, scope) : [];
    for (const tr of [...sections.thead, ...sections.tbody, ...sections.tfoot]) {
      if (tr === firstRow) continue;
      for (const cell of tr.children) {
        if (cell.type === "element" && (cell.attrs.has("data-if") || cell.attrs.has("data-unless"))) {
          failAt(
            "structure",
            "data-if / data-unless on a cell hides its whole column, so it's only allowed in the table's first row",
            cell.line
          );
        }
      }
    }

    const header = sections.thead.map((tr) => this.compileRow(tr, scope, false));
    const footer = sections.tfoot.map((tr) => this.compileRow(tr, scope, false));
    const body = this.compileTableBody(sections.tbody, scope);
    const columns = this.deriveColumns(header, body, footer, columnConditions);

    return { type: "table", style, columns, header, body, footer };
  }

  // The data-if / data-unless on each cell of the first row, expanded over its colspan.
  private columnConditions(tr: AuthoredElement, scope: string | null): (VisibleIf | undefined)[] {
    const out: (VisibleIf | undefined)[] = [];
    for (const cell of tr.children) {
      if (cell.type !== "element" || (cell.tag !== "td" && cell.tag !== "th")) continue;
      const condition = this.conditionOf(cell, scope);
      const span = this.parseColSpan(cell);
      for (let i = 0; i < span; i++) out.push(condition);
    }
    return out;
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

  private compileTableBody(trs: AuthoredElement[], scope: string | null): TableBody {
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
      if (tr.attrs.has("data-if") || tr.attrs.has("data-unless")) {
        failAt("structure", "put data-if / data-unless on the <table>, not on its data-repeat row", tr.line);
      }
      const rb = this.parseRepeat(tr.attrs.get("data-repeat") as string, scope, tr.line);
      return { repeat: rb, row: this.compileRow(tr, rb.as, true) };
    }
    return { rows: trs.map((tr) => this.compileRow(tr, scope, false)) };
  }

  private compileRow(tr: AuthoredElement, scope: string | null, isRepeatRow: boolean): RowNode {
    const style = this.styleOf(tr);
    const visibleIf = isRepeatRow ? undefined : this.conditionOf(tr, scope);
    const cells: CellNode[] = [];
    for (const child of tr.children) {
      if (child.type !== "element") continue;
      if (child.tag !== "td" && child.tag !== "th") {
        failAt("structure", `<${child.tag}> is not allowed in <tr>`, child.line);
      }
      if (child.attrs.has("data-repeat")) failAt("structure", "data-repeat isn't supported on a cell", child.line);
      cells.push(this.compileCell(child, scope));
    }
    const node: RowNode = visibleIf
      ? { type: "row", style, visibleIf, cells }
      : { type: "row", style, cells };
    this.tagNode(node, tr);
    return node;
  }

  private compileCell(cell: AuthoredElement, scope: string | null): CellNode {
    const style = this.styleOf(cell);
    const colSpan = this.parseColSpan(cell);
    const children = this.hasBlockChild(cell)
      ? this.compileBlockChildren(cell, scope)
      : this.childrenOfText(cell, scope);
    const node: CellNode = { type: "cell", style, colSpan, children };
    this.tagNode(node, cell); // a table header cell is the canonical data-token="backgroundColor:accent" site
    return node;
  }

  private childrenOfText(el: AuthoredElement, scope: string | null): TemplateNode[] {
    const text = this.buildTextNode(el.children, el, scope);
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
  // resolved `width` when it's an absolute number of points; otherwise "auto". A column hidden by
  // a first-row condition carries it as `visibleIf`.
  private deriveColumns(
    header: RowNode[],
    body: TableBody,
    footer: RowNode[],
    conditions: (VisibleIf | undefined)[]
  ): TableColumn[] {
    const sample =
      header[0] ?? body.row ?? (body.rows && body.rows[0]) ?? footer[0] ?? null;
    if (!sample) return [];
    const columns: TableColumn[] = [];
    for (const cell of sample.cells) {
      const w = cell.style.width;
      const width: number | "auto" = typeof w === "number" ? w : "auto";
      for (let i = 0; i < cell.colSpan; i++) {
        const visibleIf = conditions[columns.length];
        columns.push(visibleIf ? { width, visibleIf } : { width });
      }
    }
    return columns;
  }

  // --- data-* expression parsing (located) ------------------------------------------
  private parseRepeat(raw: string, scope: string | null, line?: number): { path: string; as: string } {
    let rb: { path: string; as: string };
    try {
      rb = parseRepeatExpression(raw);
    } catch (err) {
      if (err instanceof ValueError) failAt("binding", err.message, line);
      throw err;
    }
    if (rb!.path !== REPEATABLE) {
      failAt("binding", `data-repeat can only iterate "${REPEATABLE}" (got "${rb!.path}")`, line);
    }
    if (scope !== null) failAt("structure", "a data-repeat can't be nested inside another", line);
    if (fieldSpec(rb!.as)) {
      failAt("binding", `the data-repeat alias "${rb!.as}" is a field id; use another name, such as "item"`, line);
    }
    this.record(rb!.path, "repeat", null, line);
    return rb!;
  }

  private parsePath(raw: string, line?: number): string {
    try {
      return validatePath(raw);
    } catch (err) {
      if (err instanceof ValueError) failAt("binding", err.message, line);
      throw err;
    }
  }

  // --- template customisation: colour tokens + named sections (APP-003) -------------
  // Attach an element's data-section / data-token tags to its compiled node, and register them so
  // the document-level `theme` and `sections` can be assembled once the walk finishes.
  private tagNode(
    node: { style: ResolvedStyle; section?: string; tokens?: Record<string, string>; editorOnly?: boolean },
    el: AuthoredElement
  ): void {
    const sectionAttr = el.attrs.get("data-section");
    if (sectionAttr !== undefined) {
      const id = sectionAttr.trim();
      if (!FIELD_ID_PATTERN.test(id)) {
        failAt("structure", `section id "${sectionAttr}" must be snake_case, like "payment_details"`, el.line);
      }
      node.section = id;
      this.sectionsUsed.add(id);
    }
    this.declareSection(el, sectionAttr?.trim());
    const tokenAttr = el.attrs.get("data-token");
    if (tokenAttr !== undefined) {
      const tokens = this.parseTokens(tokenAttr, node.style, el.line);
      if (Object.keys(tokens).length) node.tokens = tokens;
    }
    // data-editor-only: mark a node the app shows only while editing and drops from every export (APP-008).
    if (el.attrs.get("data-editor-only") !== undefined) node.editorOnly = true;
  }

  // Register a section's declaration: data-section-label, data-hidable and data-fields, which go
  // together on ONE of the elements tagged with that section id.
  private declareSection(el: AuthoredElement, id: string | undefined): void {
    const labelAttr = el.attrs.get("data-section-label");
    const hidableAttr = el.attrs.get("data-hidable");
    const fieldsAttr = el.attrs.get("data-fields");
    if (labelAttr === undefined && hidableAttr === undefined && fieldsAttr === undefined) return;
    if (id === undefined) {
      failAt("fields", "data-section-label, data-hidable and data-fields need data-section on the same element", el.line);
    }
    if (this.sectionDecls.has(id!)) {
      failAt("fields", `section "${id}" is declared twice; put its label, data-hidable and data-fields on one element`, el.line);
    }

    let label = humanize(id!);
    if (labelAttr !== undefined) {
      if (labelAttr.trim().length === 0 || labelAttr.length > MAX_SECTION_LABEL) {
        failAt("fields", `data-section-label must be 1–${MAX_SECTION_LABEL} characters`, el.line);
      }
      label = labelAttr.trim();
    }
    let hidable = true;
    if (hidableAttr !== undefined) {
      if (hidableAttr !== "true" && hidableAttr !== "false") {
        failAt("fields", `data-hidable must be "true" or "false" (got "${hidableAttr}")`, el.line);
      }
      hidable = hidableAttr === "true";
    }

    const fields: FieldDefinition[] = [];
    if (fieldsAttr !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(fieldsAttr);
      } catch {
        failAt("fields", `data-fields on section "${id}" must be valid JSON`, el.line);
      }
      if (!Array.isArray(parsed)) failAt("fields", `data-fields on section "${id}" must be a JSON array`, el.line);
      const raw = parsed as unknown[];
      if (raw.length > MAX_FIELDS_PER_SECTION) {
        failAt("fields", `section "${id}" has more than ${MAX_FIELDS_PER_SECTION} fields`, el.line);
      }
      for (const item of raw) {
        try {
          fields.push(resolveField(item, { place: "template", inherited: formField }));
        } catch (err) {
          if (err instanceof FieldError) failAt("fields", `section "${id}": ${err.message}`, el.line);
          throw err;
        }
      }
    }
    this.sectionDecls.set(id!, { label, hidable, fields, line: el.line });
  }

  // Parse `data-token="styleKey:tokenName …"`. Each pair names a token for one style key; the
  // token's DEFAULT colour is read from the element's already-resolved `style` (which keeps the
  // literal hex), so a token can only be declared on a colour the element actually has.
  private parseTokens(raw: string, style: ResolvedStyle, line?: number): Record<string, string> {
    const out: Record<string, string> = {};
    for (const pair of raw.trim().split(/\s+/).filter(Boolean)) {
      const idx = pair.indexOf(":");
      if (idx <= 0 || idx === pair.length - 1) {
        failAt("structure", `invalid data-token "${pair}" (expected "styleKey:tokenName")`, line);
      }
      const styleKey = pair.slice(0, idx);
      const tokenName = pair.slice(idx + 1);
      if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(tokenName)) {
        failAt("structure", `invalid theme token name "${tokenName}"`, line);
      }
      const hex = style[styleKey];
      if (typeof hex !== "string") {
        failAt("structure", `data-token "${pair}": the element has no resolved "${styleKey}" colour to tokenise`, line);
        continue; // unreachable (failAt throws); lets TS narrow hex to string below
      }
      out[styleKey] = tokenName;
      // First occurrence in the (deterministic) tree walk fixes the token's default colour.
      if (!this.themeTokens.has(tokenName)) this.themeTokens.set(tokenName, hex);
    }
    // Emit style keys in a fixed (sorted) order for byte-identical output regardless of author order.
    return orderTokens(out);
  }

  private buildTheme(): Theme | undefined {
    if (this.themeTokens.size === 0) return undefined;
    const tokens: Record<string, ThemeToken> = {};
    for (const [name, def] of this.themeTokens) {
      tokens[name] = { default: def, label: TOKEN_LABELS[name] ?? capitalize(name) };
    }
    return { tokens };
  }

  // The sections, in editor order: the root's data-section-order when given, else the order each
  // section first appears in the document. An id tagged but never declared gets a label from its
  // id, is hidable, and lists no fields.
  private buildSections(): SectionDef[] {
    let order = [...this.sectionsUsed];
    const orderAttr = this.root.attrs.get("data-section-order");
    if (orderAttr !== undefined) {
      const listed = orderAttr.trim().split(/\s+/).filter(Boolean);
      const unknown = listed.find((id) => !this.sectionsUsed.has(id));
      if (unknown) failAt("fields", `data-section-order names "${unknown}", which no element is tagged with`, this.root.line);
      if (new Set(listed).size !== listed.length) failAt("fields", "data-section-order lists a section twice", this.root.line);
      const missing = order.find((id) => !listed.includes(id));
      if (missing) failAt("fields", `data-section-order leaves out section "${missing}"`, this.root.line);
      order = listed;
    }
    return order.map((id) => {
      const decl = this.sectionDecls.get(id);
      return {
        id,
        label: decl?.label ?? humanize(id),
        hidable: decl?.hidable ?? true,
        fields: decl?.fields ?? [],
      };
    });
  }

  // --- field checks (docs/FIELDS.md §6.5, checks 5–9) --------------------------------
  private checkFields(sections: SectionDef[]): void {
    const listed = new Map<string, FieldDefinition>();
    let lineColumns: Map<string, FieldDefinition> | undefined;

    for (const section of sections) {
      const line = this.sectionDecls.get(section.id)?.line;
      let pickerSeen = false;
      for (const f of section.fields) {
        if (!f.id) continue; // info
        if (listed.has(f.id)) {
          failAt("fields", `field "${f.id}" is listed in two sections; a field belongs to one section`, line);
        }
        listed.set(f.id, f);
        if (f.id === "customer") pickerSeen = true;
        if (f.owner === "customer" && !pickerSeen) {
          failAt("fields", `section "${section.id}" lists "${f.id}" without the "customer" picker field before it`, line);
        }
        if (f.columns) lineColumns = new Map(f.columns.filter((c) => c.id).map((c) => [c.id!, c]));
      }
    }

    // Every visibleIf and relativeTo must point at a listed field (a column may also point at a
    // column of the same line).
    for (const section of sections) {
      const line = this.sectionDecls.get(section.id)?.line;
      const check = (f: FieldDefinition, siblings?: Map<string, FieldDefinition>): void => {
        const who = f.id ? `field "${f.id}"` : "an info field";
        if (f.visibleIf && !listed.has(f.visibleIf.path) && !siblings?.has(f.visibleIf.path)) {
          failAt("fields", `${who}: visibleIf points at "${f.visibleIf.path}", which no section lists`, line);
        }
        if (f.relativeTo && !listed.has(f.relativeTo)) {
          failAt("fields", `${who}: relativeTo "${f.relativeTo}" isn't listed in any section`, line);
        }
        for (const c of f.columns ?? []) check(c, lineColumns);
      };
      for (const f of section.fields) check(f);
    }

    for (const p of this.paths) this.checkPath(p, listed, lineColumns);
  }

  // A printed/tested path must resolve to a listed field (or a calculated value), and an image
  // or repeat must point at the right kind of field.
  private checkPath(
    p: PathRecord,
    listed: Map<string, FieldDefinition>,
    lineColumns: Map<string, FieldDefinition> | undefined
  ): void {
    const segments = p.path.split(".");
    let type: FieldType;
    let rest: string[];

    if (p.scope !== null && segments[0] === p.scope) {
      const col = segments[1];
      if (col === undefined) {
        failAt("binding", `"${p.path}": name a line-item column, e.g. "${p.scope}.description"`, p.line);
      }
      const def = lineColumns?.get(col);
      if (def) type = def.type;
      else if (LINE_COMPUTED_IDS.includes(col)) type = "computed";
      else {
        return failAt("binding", `"${p.path}": "${col}" isn't a column of the line_items field (add it to "columns")`, p.line);
      }
      rest = segments.slice(2);
    } else {
      const id = segments[0];
      const def = listed.get(id);
      if (def) type = def.type;
      else if (COMPUTED_IDS.includes(id)) type = "computed";
      else if (fieldSpec(id)) {
        const owner = fieldSpec(id)!.owner;
        const hint =
          owner === "line" || owner === "line_computed"
            ? ` — line-item values are printed inside data-repeat="line_items as item", as item.${id}`
            : " — add it to a section's data-fields";
        return failAt("binding", `"${p.path}": "${id}" isn't listed in any section${hint}`, p.line);
      } else {
        return failAt("binding", `"${p.path}": "${id}" isn't a field id`, p.line);
      }
      rest = segments.slice(1);
      if (p.use === "repeat" && (id !== REPEATABLE || rest.length > 0)) {
        failAt("binding", `data-repeat can only iterate "${REPEATABLE}"`, p.line);
      }
    }

    const isImage = type === "image" || type === "signature";
    if (rest.length > 0) {
      if (!(isImage && rest.length === 1 && (rest[0] === "url" || rest[0] === "thumbnailUrl"))) {
        failAt("binding", `"${p.path}": a ${type} value has no "${rest.join(".")}"`, p.line);
      }
    }
    if (p.use === "image" && !(isImage && rest.length === 1)) {
      failAt("binding", `an <img> src must bind an image or signature field's url, like {{ company_logo.url }}`, p.line);
    }
    if (p.use === "print" && rest.length === 0) {
      if (isImage) failAt("binding", `"${p.path}" is an image; show it with <img src="{{ ${p.path}.url }}">`, p.line);
      if (type === "discount") failAt("binding", `"${p.path}" can't be printed; print discount_total instead`, p.line);
      if (type === "line_items") failAt("binding", `"${p.path}" can't be printed; iterate it with data-repeat`, p.line);
      if (type === "customer") failAt("binding", `"${p.path}" is the customer's id; print customer_name instead`, p.line);
    }
  }

  // `color` is an INHERITED property, so a color token declared on an element (e.g. a <div> that
  // compiles to a box, whose text lives in child text nodes) must reach the text nodes that actually
  // draw that colour. Walk top-down carrying the active color token; attach it to every text node
  // that draws the token's colour and has no color token of its own. Mirrors how the cascade already
  // inherits `color` down the tree, and fixes the under-application in APP-004.
  private propagateColorTokens(
    node: TemplateNode,
    inherited: { name: string; value: string } | undefined
  ): void {
    // Structural wrappers carry no style — pass the inherited token straight to the child.
    if (node.type === "repeat" || node.type === "conditional") {
      this.propagateColorTokens(node.child, inherited);
      return;
    }

    let active = inherited;
    const own = node.tokens?.color;
    const color = typeof node.style.color === "string" ? node.style.color.toLowerCase() : undefined;

    if (own) {
      // This node re-declares the color token; it and its subtree inherit THIS one.
      active = { name: own, value: color ?? inherited?.value ?? "" };
    } else if (color !== undefined && active) {
      if (color === active.value.toLowerCase()) {
        // Draws the inherited token's colour — only a text node makes that visible, so tag it there.
        if (node.type === "text") node.tokens = orderTokens({ ...(node.tokens ?? {}), color: active.name });
      } else {
        // Overrides color to a non-token colour — its subtree must not inherit the old token.
        active = undefined;
      }
    }

    // A `text` node's spans carry their own resolved `style`; a <span>/<strong>/<em> run emits an
    // explicit `color` (often just the inherited one) that would OVERRIDE the node's token and keep
    // the old colour. Tag any span drawing the active token's colour so it recolours too (APP-006).
    // A span with no color, or a genuinely different one, is left alone.
    if (node.type === "text" && active) {
      const want = active.value.toLowerCase();
      for (const span of node.spans) {
        const sc = typeof span.style?.color === "string" ? span.style.color.toLowerCase() : undefined;
        if (sc !== undefined && sc === want) {
          span.tokens = orderTokens({ ...(span.tokens ?? {}), color: active.name });
        }
      }
    }

    if (node.type === "box" || node.type === "cell") {
      for (const c of node.children) this.propagateColorTokens(c, active);
    } else if (node.type === "row") {
      for (const c of node.cells) this.propagateColorTokens(c, active);
    } else if (node.type === "table") {
      for (const r of node.header) this.propagateColorTokens(r, active);
      if (node.body.row) this.propagateColorTokens(node.body.row, active);
      if (node.body.rows) for (const r of node.body.rows) this.propagateColorTokens(r, active);
      for (const r of node.footer) this.propagateColorTokens(r, active);
    }
    // text / image / divider have no text-bearing children.
  }

  // Optional, author-declared customisation sheet (APP-005): a JSON array on the root's
  // `data-customisation` attribute, emitted in author (display) order. A control whose `type` this
  // build doesn't special-case is still emitted (type + optional title) — the app ignores unknown
  // types — so new control types ship backend-first. A color/section control must name a token /
  // section this template actually declares.
  private buildCustomisation(theme: Theme | undefined, sections: SectionDef[]): CustomisationControl[] | undefined {
    const raw = this.root.attrs.get("data-customisation");
    if (raw === undefined) return undefined;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      failAt("structure", "data-customisation must be valid JSON", this.root.line);
    }
    if (!Array.isArray(parsed)) {
      failAt("structure", "data-customisation must be a JSON array", this.root.line);
    }
    const arr = parsed as unknown[];
    if (arr.length > 32) {
      failAt("structure", "data-customisation has too many controls (max 32)", this.root.line);
    }

    const out: CustomisationControl[] = [];
    for (const item of arr) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        failAt("structure", "each data-customisation entry must be an object", this.root.line);
        continue; // unreachable — failAt throws
      }
      const rec = item as Record<string, unknown>;
      if (typeof rec.type !== "string" || rec.type.length === 0) {
        failAt("structure", 'each data-customisation entry needs a non-empty string "type"', this.root.line);
        continue; // unreachable
      }
      const control: CustomisationControl = { type: rec.type };
      if (typeof rec.title === "string") control.title = rec.title;
      if (rec.type === "color") {
        if (typeof rec.token !== "string" || rec.token.length === 0) {
          failAt("structure", 'a "color" customisation control needs a string "token"', this.root.line);
        }
        if (!theme || !(rec.token as string in theme.tokens)) {
          failAt("structure", `customisation names colour token "${rec.token}", which no data-token declares`, this.root.line);
        }
        control.token = rec.token as string;
      } else if (rec.type === "section") {
        if (typeof rec.section !== "string" || rec.section.length === 0) {
          failAt("structure", 'a "section" customisation control needs a string "section"', this.root.line);
        }
        if (!sections.some((s) => s.id === rec.section)) {
          failAt("structure", `customisation names section "${rec.section}", which no element is tagged with`, this.root.line);
        }
        control.section = rec.section as string;
      }
      out.push(control);
    }
    return out.length ? out : undefined;
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
    this.rejectDataAttrs(this.root, ["data-if", "data-unless", "data-repeat"], "the root element");
    const rootNode = this.compileElement(this.root, null) as BoxNode | TextNode;
    this.tagNode(rootNode, this.root);
    stripPadding(rootNode.style);
    // Push color tokens down to the text nodes that actually draw them (APP-004).
    this.propagateColorTokens(rootNode, undefined);

    const theme = this.buildTheme();
    const sections = this.buildSections();
    this.checkFields(sections);
    const customisation = this.buildCustomisation(theme, sections);

    const compiled: CompiledTemplate = {
      schemaVersion: SCHEMA_VERSION,
      compilerVersion: COMPILER_VERSION,
      page,
      // Present only when the template declares colour tokens (APP-003). Absent (not empty) when it
      // doesn't.
      ...(theme ? { theme } : {}),
      sections,
      ...(customisation ? { customisation } : {}),
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
