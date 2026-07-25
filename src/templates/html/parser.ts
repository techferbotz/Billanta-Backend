import { parseFragment } from "parse5";
import { failAt } from "../compile/errors";

// HTML parsing + whitelist validation. parse5 turns the authored HTML into a tree; we walk
// it into our own small AuthoredNode tree, rejecting anything outside the supported subset
// with an exact source location. Decoupling from parse5's node shape here means the rest of
// the compiler never imports parse5.

// The ONLY element tags a template may use. Everything else — script, iframe, form, style,
// link, svg, … — is rejected. `tfoot` is included (beyond the base spec's table tags) because
// the compiled table has a `footer`, and tfoot is where an invoice's totals row belongs.
const ALLOWED_TAGS = new Set([
  "div", "span", "p",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th",
  "img", "hr", "br",
  "strong", "em",
  "ul", "ol", "li",
]);

// Void elements carry no children.
const VOID_TAGS = new Set(["img", "hr", "br"]);

export interface AuthoredElement {
  type: "element";
  tag: string;
  attrs: Map<string, string>;
  children: AuthoredNode[];
  line?: number;
  column?: number;
}

export interface AuthoredText {
  type: "text";
  text: string;
  line?: number;
}

export type AuthoredNode = AuthoredElement | AuthoredText;

// Minimal structural views of parse5 nodes — enough to walk the tree without importing its
// full (large) type surface.
interface P5Location {
  startLine?: number;
  startCol?: number;
}
interface P5Node {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: P5Node[];
  sourceCodeLocation?: P5Location | null;
}

const loc = (n: P5Node): { line?: number; column?: number } => ({
  line: n.sourceCodeLocation?.startLine,
  column: n.sourceCodeLocation?.startCol,
});

// The compiler walks the tree recursively in several passes (convert here, then the cascade,
// then the emit walk). Bounding depth ONCE, at parse, protects them all from a
// stack-overflow RangeError on pathologically nested input — turning it into a clean,
// located CompileError instead of a 500.
const MAX_DEPTH = 200;

// Convert one parse5 node into an AuthoredNode, validating as we go. Returns null for nodes
// that carry no authored content (comments, and parse5's synthetic document pieces).
const convert = (n: P5Node, depth: number): AuthoredNode | null => {
  if (n.nodeName === "#text") {
    return { type: "text", text: n.value ?? "", line: n.sourceCodeLocation?.startLine };
  }
  if (n.nodeName === "#comment") return null;

  // An element.
  const tag = (n.tagName ?? n.nodeName).toLowerCase();
  const { line, column } = loc(n);

  if (depth > MAX_DEPTH) {
    failAt("structure", `template nesting is too deep (max ${MAX_DEPTH})`, line, column);
  }

  if (!ALLOWED_TAGS.has(tag)) {
    failAt("html", `unsupported tag <${tag}>`, line, column);
  }

  const attrs = new Map<string, string>();
  for (const attr of n.attrs ?? []) {
    const name = attr.name.toLowerCase();
    // Event handlers are never allowed — they'd be inert on the client anyway, but rejecting
    // them keeps authored templates honestly free of behavior.
    if (name.startsWith("on")) {
      failAt("html", `event-handler attribute "${name}" is not allowed on <${tag}>`, line, column);
    }
    attrs.set(name, attr.value);
  }

  const children: AuthoredNode[] = [];
  if (!VOID_TAGS.has(tag)) {
    for (const child of n.childNodes ?? []) {
      const converted = convert(child, depth + 1);
      if (converted) children.push(converted);
    }
  }

  return { type: "element", tag, attrs, children, line, column };
};

/**
 * Parse authored HTML into a single root AuthoredElement.
 *
 * A template must have exactly ONE root element (the page container). Whitespace-only text
 * around it is ignored; any second root element or stray text is a structure error.
 */
export const parseHtml = (html: string): AuthoredElement => {
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true }) as unknown as {
    childNodes: P5Node[];
  };

  const roots: AuthoredNode[] = [];
  for (const node of fragment.childNodes) {
    const converted = convert(node, 0);
    if (!converted) continue;
    // Ignore insignificant whitespace between/around the root.
    if (converted.type === "text" && converted.text.trim().length === 0) continue;
    roots.push(converted);
  }

  if (roots.length === 0) {
    failAt("html", "template is empty — expected a single root element");
  }
  const first = roots[0];
  if (first.type !== "element") {
    failAt("html", "template must start with a single root element, not text", first.line);
  }
  if (roots.length > 1) {
    const extra = roots[1];
    failAt(
      "html",
      "template must have exactly one root element",
      extra.type === "element" ? extra.line : extra.line
    );
  }
  return first as AuthoredElement;
};
