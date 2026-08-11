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

// The canonical section vocabulary (APP-003 + APP-007): stable id -> human label, whether the app may
// hide the block, and `edits` (what data tapping it edits). The ORDER here is the order sections are
// emitted — i.e. the editor's fill order: details, customer, items, totals, then the optional blocks.
// An author tags a top-level block with data-section="<id>"; an id outside this list still works
// (emitted with a derived label, hidable, and no `edits`), so the vocabulary can grow.
const SECTION_VOCAB: { id: string; label: string; hidable: boolean; edits: string }[] = [
  { id: "header", label: "Invoice details", hidable: false, edits: "invoiceDetails" },
  { id: "parties", label: "Bill to", hidable: false, edits: "customer" },
  { id: "items", label: "Items", hidable: false, edits: "items" },
  { id: "totals", label: "Total", hidable: false, edits: "discount" },
  { id: "notes", label: "Notes", hidable: true, edits: "notes" },
  { id: "payment", label: "Payment details", hidable: true, edits: "company" },
  { id: "signature", label: "Signature", hidable: true, edits: "company" },
  { id: "terms", label: "Terms", hidable: true, edits: "none" },
];

// Human labels for the colour tokens users recognise; any other token name gets a capitalised
// fallback so an author can invent a token without editing the compiler.
const TOKEN_LABELS: Record<string, string> = {
  accent: "Accent",
  ink: "Text",
  muted: "Secondary text",
};

const capitalize = (s: string): string => (s.length ? s[0].toUpperCase() + s.slice(1) : s);

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

// One compile run. Holds the resolved-style map and the insideRepeat flag so the tree walk
// can stay a set of small methods.
class Compiler {
  private readonly styles: Map<AuthoredElement, ResolvedStyle>;
  // Template-customisation collectors, filled by tagNode during the tree walk (APP-003). A Map and
  // a Set both preserve first-occurrence order, so buildTheme/buildSections stay deterministic.
  private readonly themeTokens = new Map<string, string>(); // token name -> default hex
  private readonly sectionsUsed = new Set<string>();

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
    // Attach data-section / data-token to the element's OWN node, before any repeat/conditional
    // wrapper (which carries no style or tags). [APP-003]
    if ("style" in node) this.tagNode(node, el);

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
    const node: RowNode = { type: "row", style, cells };
    this.tagNode(node, tr);
    return node;
  }

  private compileCell(cell: AuthoredElement, insideRepeat: boolean): CellNode {
    const style = this.styleOf(cell);
    const colSpan = this.parseColSpan(cell);
    const children = this.hasBlockChild(cell)
      ? this.compileBlockChildren(cell, insideRepeat)
      : this.childrenOfText(cell);
    const node: CellNode = { type: "cell", style, colSpan, children };
    this.tagNode(node, cell); // a table header cell is the canonical data-token="backgroundColor:accent" site
    return node;
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

  // --- template customisation: colour tokens + named sections (APP-003) -------------
  // Attach an element's data-section / data-token tags to its compiled node, and register them so
  // the document-level `theme` and `sections` can be assembled once the walk finishes.
  private tagNode(
    node: { style: ResolvedStyle; section?: string; tokens?: Record<string, string> },
    el: AuthoredElement
  ): void {
    const sectionAttr = el.attrs.get("data-section");
    if (sectionAttr !== undefined) {
      const id = sectionAttr.trim();
      if (id.length) {
        node.section = id;
        this.sectionsUsed.add(id);
      }
    }
    const tokenAttr = el.attrs.get("data-token");
    if (tokenAttr !== undefined) {
      const tokens = this.parseTokens(tokenAttr, node.style, el.line);
      if (Object.keys(tokens).length) node.tokens = tokens;
    }
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

  private buildSections(): SectionDef[] {
    if (this.sectionsUsed.size === 0) return [];
    const out: SectionDef[] = [];
    // Canonical vocabulary first, in canonical order, for the ids the template actually used…
    for (const def of SECTION_VOCAB) {
      if (this.sectionsUsed.has(def.id)) {
        out.push({ id: def.id, label: def.label, hidable: def.hidable, edits: def.edits });
      }
    }
    // …then any id outside the vocabulary, in first-occurrence order, defaulting to hidable.
    for (const id of this.sectionsUsed) {
      if (!SECTION_VOCAB.some((d) => d.id === id)) {
        out.push({ id, label: capitalize(id), hidable: true });
      }
    }
    return out;
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
  // types and unresolved token/section bindings — so new control types ship backend-first.
  private buildCustomisation(): CustomisationControl[] | undefined {
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
        control.token = rec.token as string;
      } else if (rec.type === "section") {
        if (typeof rec.section !== "string" || rec.section.length === 0) {
          failAt("structure", 'a "section" customisation control needs a string "section"', this.root.line);
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
    const rootNode = this.compileElement(this.root, false) as BoxNode | TextNode;
    this.tagNode(rootNode, this.root);
    stripPadding(rootNode.style);
    // Push color tokens down to the text nodes that actually draw them (APP-004).
    this.propagateColorTokens(rootNode, undefined);

    // Assembled from what the tree walk collected; included only when non-empty so an untagged
    // template's bytes (and checksum) are exactly as before. [APP-003 / APP-005]
    const theme = this.buildTheme();
    const sections = this.buildSections();
    const customisation = this.buildCustomisation();

    const compiled: CompiledTemplate = {
      schemaVersion: SCHEMA_VERSION,
      compilerVersion: COMPILER_VERSION,
      page,
      ...(theme ? { theme } : {}),
      ...(sections.length ? { sections } : {}),
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
