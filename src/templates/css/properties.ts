import { StyleValue } from "../compile/nodes";
import { ValueError } from "../compile/errors";
import { parseLength, parseLineHeight, parseOpacity, parseFontWeight } from "./units";
import { normalizeColor } from "./colors";

// The CSS subset, as a data-driven registry. Three concerns live here:
//   1. expandDeclaration — accept an authored CSS declaration (shorthand or longhand) and
//      expand it into camelCase LONGHAND declarations, or reject an unsupported property.
//   2. normalizeValue — turn a longhand key + raw value into the final resolved StyleValue
//      (points / hex / keyword / number), or reject an unsupported value.
//   3. PROPERTY_ORDER + INHERITED — the emission order (for deterministic output) and which
//      properties inherit down the tree.
//
// Splitting "expand" (pre-cascade) from "normalize" (post-cascade) is deliberate: shorthands
// must expand to longhands BEFORE the cascade so that e.g. `padding-left` correctly overrides
// an earlier `padding`, while unit/color normalization must happen AFTER the cascade picks the
// winning raw value.

// Value categories drive normalization.
type Category =
  | "length" // -> points (number)
  | "lengthPct" // -> points (number) or "50%"
  | "color" // -> #rrggbb / #rrggbbaa
  | "keyword" // -> lowercased string
  | "fontWeight"
  | "lineHeight"
  | "opacity"
  | "flex"
  | "fontFamily";

// Every longhand key the compiler can emit, with its category and inheritance. This is the
// authoritative list of output style keys; the renderer may ignore any it doesn't know.
interface KeyMeta {
  category: Category;
  inherited: boolean;
}

const K: Record<string, KeyMeta> = {
  // layout
  display: { category: "keyword", inherited: false },
  flexDirection: { category: "keyword", inherited: false },
  justifyContent: { category: "keyword", inherited: false },
  alignItems: { category: "keyword", inherited: false },
  flexWrap: { category: "keyword", inherited: false },
  gap: { category: "length", inherited: false },
  flex: { category: "flex", inherited: false },
  // box
  paddingTop: { category: "length", inherited: false },
  paddingRight: { category: "length", inherited: false },
  paddingBottom: { category: "length", inherited: false },
  paddingLeft: { category: "length", inherited: false },
  // margins use lengthPct so they accept `auto` (centering / right-aligning) and percentages.
  marginTop: { category: "lengthPct", inherited: false },
  marginRight: { category: "lengthPct", inherited: false },
  marginBottom: { category: "lengthPct", inherited: false },
  marginLeft: { category: "lengthPct", inherited: false },
  width: { category: "lengthPct", inherited: false },
  height: { category: "lengthPct", inherited: false },
  minWidth: { category: "lengthPct", inherited: false },
  maxWidth: { category: "lengthPct", inherited: false },
  minHeight: { category: "lengthPct", inherited: false },
  maxHeight: { category: "lengthPct", inherited: false },
  // border
  borderTopWidth: { category: "length", inherited: false },
  borderRightWidth: { category: "length", inherited: false },
  borderBottomWidth: { category: "length", inherited: false },
  borderLeftWidth: { category: "length", inherited: false },
  borderTopStyle: { category: "keyword", inherited: false },
  borderRightStyle: { category: "keyword", inherited: false },
  borderBottomStyle: { category: "keyword", inherited: false },
  borderLeftStyle: { category: "keyword", inherited: false },
  borderTopColor: { category: "color", inherited: false },
  borderRightColor: { category: "color", inherited: false },
  borderBottomColor: { category: "color", inherited: false },
  borderLeftColor: { category: "color", inherited: false },
  borderRadius: { category: "length", inherited: false },
  // background
  backgroundColor: { category: "color", inherited: false },
  // text (mostly inherited)
  color: { category: "color", inherited: true },
  fontSize: { category: "length", inherited: true },
  fontWeight: { category: "fontWeight", inherited: true },
  fontStyle: { category: "keyword", inherited: true },
  fontFamily: { category: "fontFamily", inherited: true },
  lineHeight: { category: "lineHeight", inherited: true },
  textAlign: { category: "keyword", inherited: true },
  textTransform: { category: "keyword", inherited: true },
  letterSpacing: { category: "length", inherited: true },
  // misc
  overflow: { category: "keyword", inherited: false },
  verticalAlign: { category: "keyword", inherited: false },
  opacity: { category: "opacity", inherited: false },
};

// Canonical emission order — a stable order over the keys above, so the same resolved style
// always serializes byte-identically regardless of authored declaration order.
export const PROPERTY_ORDER: string[] = Object.keys(K);

export const INHERITED: Set<string> = new Set(
  PROPERTY_ORDER.filter((k) => K[k].inherited)
);

export const isKnownKey = (key: string): boolean => key in K;

// --- fonts --------------------------------------------------------------------------
// Fonts bundled in the Android app. font-family must resolve to one of these — the client
// never falls back to a system face silently (which would change the invoice's look).
const FONT_WHITELIST = new Set(["Inter", "Roboto", "Open Sans", "Lato", "Montserrat"]);
// Generic families map to a bundled default rather than being rejected.
const GENERIC_FONT: Record<string, string> = {
  "sans-serif": "Inter",
  serif: "Inter",
  monospace: "Inter",
};

const normalizeFontFamily = (raw: string): string => {
  // Take the first family in the list.
  const first = raw.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
  const lower = first.toLowerCase();
  if (lower in GENERIC_FONT) return GENERIC_FONT[lower];
  // Case-insensitive match against the whitelist, returning the canonical casing.
  for (const font of FONT_WHITELIST) {
    if (font.toLowerCase() === lower) return font;
  }
  throw new ValueError(
    `font-family "${first}" is not a bundled font (use one of: ${[...FONT_WHITELIST].join(", ")})`
  );
};

// flex shorthand: keep a normalized string. Accept a bare grow number ("1") or the
// grow/shrink/basis form; reject anything with functions/units we don't model.
const normalizeFlex = (raw: string): string => {
  const value = raw.trim().toLowerCase();
  if (value === "none" || value === "auto") return value;
  if (/^\d+(\s+\d+(\s+(0|auto|\d+(px|pt)?))?)?$/.test(value)) return value.replace(/\s+/g, " ");
  throw new ValueError(`unsupported flex value "${raw}"`);
};

// Normalize a longhand key's raw value into the final StyleValue. Throws ValueError on a bad
// value; the cascade adds the property/line location.
export const normalizeValue = (key: string, raw: string): StyleValue => {
  const meta = K[key];
  if (!meta) throw new ValueError(`internal: unknown style key "${key}"`);
  switch (meta.category) {
    case "length":
      return parseLength(raw, false, false);
    case "lengthPct":
      return parseLength(raw, true, true);
    case "color":
      return normalizeColor(raw);
    case "fontWeight":
      return parseFontWeight(raw);
    case "lineHeight":
      return parseLineHeight(raw);
    case "opacity":
      return parseOpacity(raw);
    case "flex":
      return normalizeFlex(raw);
    case "fontFamily":
      return normalizeFontFamily(raw);
    case "keyword":
      return raw.trim().toLowerCase();
  }
};

// --- shorthand expansion ------------------------------------------------------------
export interface RawLonghand {
  key: string; // camelCase longhand
  value: string; // still raw; normalized after the cascade
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// Split a box shorthand value (padding/margin) into its 1-4 tokens per CSS rules.
const boxSides = (value: string): { top: string; right: string; bottom: string; left: string } => {
  const t = value.trim().split(/\s+/);
  if (t.length === 1) return { top: t[0], right: t[0], bottom: t[0], left: t[0] };
  if (t.length === 2) return { top: t[0], right: t[1], bottom: t[0], left: t[1] };
  if (t.length === 3) return { top: t[0], right: t[1], bottom: t[2], left: t[1] };
  if (t.length === 4) return { top: t[0], right: t[1], bottom: t[2], left: t[3] };
  throw new ValueError(`expected 1-4 values, got "${value}"`);
};

const BORDER_STYLES = new Set(["none", "hidden", "solid", "dashed", "dotted", "double", "groove", "ridge", "inset", "outset"]);

// Classify the tokens of a `border`/`border-<side>` triple into width/style/color parts.
const parseBorderTriple = (value: string): { width?: string; style?: string; color?: string } => {
  const out: { width?: string; style?: string; color?: string } = {};
  for (const tok of value.trim().split(/\s+/)) {
    const t = tok.toLowerCase();
    if (BORDER_STYLES.has(t)) out.style = t;
    else if (/^(0|-?\d+(\.\d+)?(px|pt)?)$/.test(t)) out.width = tok;
    else out.color = tok; // anything else is assumed a color; normalizeColor validates it later
  }
  return out;
};

const SIDES = ["Top", "Right", "Bottom", "Left"] as const;

/**
 * Expand one authored declaration into camelCase longhands, or throw ValueError if the
 * property isn't supported. `url(...)` anywhere is rejected up front (no external resources).
 */
export const expandDeclaration = (cssProp: string, rawValue: string): RawLonghand[] => {
  const prop = cssProp.trim().toLowerCase();
  const value = rawValue.trim();

  if (/url\s*\(/i.test(value)) {
    throw new ValueError(`external resources via url() are not allowed ("${cssProp}")`);
  }

  // Direct 1:1 longhands and simple single-key properties.
  const DIRECT: Record<string, string> = {
    display: "display",
    "flex-direction": "flexDirection",
    "justify-content": "justifyContent",
    "align-items": "alignItems",
    "flex-wrap": "flexWrap",
    gap: "gap",
    flex: "flex",
    width: "width",
    height: "height",
    "min-width": "minWidth",
    "max-width": "maxWidth",
    "min-height": "minHeight",
    "max-height": "maxHeight",
    "background-color": "backgroundColor",
    color: "color",
    "font-size": "fontSize",
    "font-weight": "fontWeight",
    "font-style": "fontStyle",
    "font-family": "fontFamily",
    "line-height": "lineHeight",
    "text-align": "textAlign",
    "text-transform": "textTransform",
    "letter-spacing": "letterSpacing",
    overflow: "overflow",
    "vertical-align": "verticalAlign",
    opacity: "opacity",
    "border-radius": "borderRadius",
    "padding-top": "paddingTop",
    "padding-right": "paddingRight",
    "padding-bottom": "paddingBottom",
    "padding-left": "paddingLeft",
    "margin-top": "marginTop",
    "margin-right": "marginRight",
    "margin-bottom": "marginBottom",
    "margin-left": "marginLeft",
  };
  if (prop in DIRECT) {
    // border-radius: keep only the first radius value (uniform corners for V1).
    if (prop === "border-radius") return [{ key: "borderRadius", value: value.split(/\s+/)[0] }];
    return [{ key: DIRECT[prop], value }];
  }

  // background: color only (url/gradient already rejected above).
  if (prop === "background") return [{ key: "backgroundColor", value }];

  // padding / margin box shorthands.
  if (prop === "padding" || prop === "margin") {
    const s = boxSides(value);
    const base = prop === "padding" ? "padding" : "margin";
    return [
      { key: `${base}Top`, value: s.top },
      { key: `${base}Right`, value: s.right },
      { key: `${base}Bottom`, value: s.bottom },
      { key: `${base}Left`, value: s.left },
    ];
  }

  // border family.
  const borderMatch = /^border(?:-(top|right|bottom|left))?(?:-(width|style|color))?$/.exec(prop);
  if (borderMatch) {
    const side = borderMatch[1]; // top|right|bottom|left | undefined (all)
    const sub = borderMatch[2]; // width|style|color | undefined (triple)
    const sides = side ? [cap(side)] : [...SIDES];

    if (sub) {
      // border-width / border-color / border-style (optionally per-side).
      const subCap = cap(sub);
      if (side) return [{ key: `border${cap(side)}${subCap}`, value }];
      // no side: 1-4 values across the four sides (like the box shorthand).
      const s = boxSides(value);
      const bySide: Record<string, string> = { Top: s.top, Right: s.right, Bottom: s.bottom, Left: s.left };
      return SIDES.map((sd) => ({ key: `border${sd}${subCap}`, value: bySide[sd] }));
    }

    // `border` or `border-<side>`: a width/style/color triple.
    const triple = parseBorderTriple(value);
    const out: RawLonghand[] = [];
    for (const sd of sides) {
      if (triple.width !== undefined) out.push({ key: `border${sd}Width`, value: triple.width });
      if (triple.style !== undefined) out.push({ key: `border${sd}Style`, value: triple.style });
      if (triple.color !== undefined) out.push({ key: `border${sd}Color`, value: triple.color });
    }
    if (out.length === 0) throw new ValueError(`empty border declaration "${cssProp}: ${rawValue}"`);
    return out;
  }

  throw new ValueError(`unsupported property "${cssProp}"`);
};
