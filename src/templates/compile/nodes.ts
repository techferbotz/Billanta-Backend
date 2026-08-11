// The Billanta Template JSON contract — the types the compiler EMITS and the Android
// renderer is built against. This file is the single source of truth for that shape.
//
// Design rule the whole system rests on: the tree is FULLY RESOLVED. Every node carries an
// absolute `style` (cascade applied, inheritance flattened, units in points, colors as hex),
// and every dynamic value is a typed binding node — never a string the client must template.
// The client renderer does no cascade, no inheritance, no unit math, no string interpolation.
//
// Forward-compatibility rule (documented in docs/TEMPLATE_JSON.md): the renderer MUST IGNORE
// unknown node `type`s and unknown style keys rather than crash. That is what lets the server
// ship new template capabilities without a Play Store release.

// Bump COMPILER_VERSION when the emitted tree changes in a way an older renderer can't handle;
// bump SCHEMA_VERSION only for a structural break. Both are stamped into every compile so a
// client can detect a tree it is too old to render.
export const SCHEMA_VERSION = 1;
export const COMPILER_VERSION = 1;

// The conversion the compiler bakes in so the client never converts units. CSS px are assumed
// at 96dpi; 1pt = 1/72in, so 1px = 0.75pt.
export const PX_TO_PT = 0.75;

// A resolved style is a flat bag of normalized properties. Values are either an absolute
// number in POINTS (lengths), a percentage string like "50%" (for width/height), a hex color
// "#RRGGBB"/"#RRGGBBAA", or a normalized keyword. Keys are camelCase.
//
// Deliberately `Record<string, ...>` rather than a fixed interface: the renderer ignores keys
// it doesn't know, so adding a property is backward-compatible. STYLE_KEY_ORDER in cascade.ts
// pins the emission order for deterministic output.
export type StyleValue = number | string;
export type ResolvedStyle = Record<string, StyleValue>;

// --- Bindings ----------------------------------------------------------------------
// A value is either a compile-time literal or a runtime binding into the invoice data.
// Formatting stays on the client (it renders offline in the invoice's currency/locale); the
// compiler only emits a `format` HINT.
export type BindingFormat = "text" | "currency" | "date" | "number";

export interface LiteralValue {
  kind: "literal";
  text: string;
}

export interface BindValue {
  kind: "bind";
  path: string; // e.g. "invoice.number", "item.amount" — resolved by the client at render
  format: BindingFormat;
  fallback: string; // shown when the path is missing/empty; "" if none
}

export type Value = LiteralValue | BindValue;

// A run of text within a text node. Carries an optional inline `style` (an extension over the
// base spec) so bold/italic inline runs — "Total: **5,000**" — are representable.
export interface Span {
  value: Value;
  style?: ResolvedStyle;
  // Like a node's `tokens` (APP-006): maps a style key (in practice `color`) to a theme-token name so
  // an inline run recolours with its theme. `style` keeps the literal hex; an older app ignores this.
  tokens?: Record<string, string>;
}

// --- Nodes -------------------------------------------------------------------------

// Optional template-customisation tags (APP-003), present only when the author tagged the element.
// `section` names a top-level block the app may show/hide; `tokens` maps a resolved style key to a
// theme-token name so the app can recolour it while `style` keeps the literal default hex. An older
// renderer, knowing neither key, ignores both and renders exactly as before.
export interface Tagged {
  section?: string;
  tokens?: Record<string, string>;
}

export interface BoxNode extends Tagged {
  type: "box";
  style: ResolvedStyle;
  children: TemplateNode[];
}

export interface TextNode extends Tagged {
  type: "text";
  style: ResolvedStyle;
  spans: Span[];
}

export interface ImageNode extends Tagged {
  type: "image";
  style: ResolvedStyle;
  source: Value; // always a binding in practice — external URLs are rejected at compile time
  fit: "contain" | "cover";
}

export interface DividerNode extends Tagged {
  type: "divider";
  style: ResolvedStyle;
}

export interface CellNode extends Tagged {
  type: "cell";
  style: ResolvedStyle;
  colSpan: number;
  children: TemplateNode[];
}

export interface RowNode extends Tagged {
  type: "row";
  style: ResolvedStyle;
  cells: CellNode[];
}

// A column's width: an absolute number in points, or "auto" to size to content.
export interface TableColumn {
  width: number | "auto";
}

// The description of a repeated section: iterate `path` (an array in the invoice data),
// binding each element to `as` for the child's binding paths.
export interface RepeatBinding {
  path: string;
  as: string;
}

// A table. `header`/`footer` are static rows; `body` is EITHER a repeating row (the invoice
// line-items case: one <tr data-repeat="items as item">) or a list of static rows — never
// both. The renderer handles whichever key is present.
export interface TableBody {
  repeat?: RepeatBinding;
  row?: RowNode; // present iff `repeat` is
  rows?: RowNode[]; // static rows, when the tbody has no data-repeat
}

export interface TableNode extends Tagged {
  type: "table";
  style: ResolvedStyle;
  columns: TableColumn[];
  header: RowNode[];
  body: TableBody;
  footer: RowNode[];
}

// Generic list repetition for non-table content (e.g. a stack of cards).
export interface RepeatNode {
  type: "repeat";
  path: string;
  as: string;
  child: TemplateNode;
}

// Render `child` only when `path` is truthy in the invoice data.
export interface ConditionalNode {
  type: "conditional";
  path: string;
  child: TemplateNode;
}

export type TemplateNode =
  | BoxNode
  | TextNode
  | ImageNode
  | DividerNode
  | TableNode
  | RowNode
  | CellNode
  | RepeatNode
  | ConditionalNode;

// --- Page + document ---------------------------------------------------------------
export interface PageMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PageSetup {
  size: "A4"; // only A4 for V1; the field exists so more can be added compatibly
  margin: PageMargin; // points
  fontFamily: string;
  baseFontSize: number; // points
}

// A named colour a template exposes for the app to override. `default` is the template's own hex
// (the same value `style` already carries); `label` is a human name for the app's colour picker.
export interface ThemeToken {
  default: string;
  label: string;
}

export interface Theme {
  tokens: Record<string, ThemeToken>;
}

// A top-level block the app can build a show/hide toggle for. `hidable: false` marks blocks that
// must always render (header, bill-to, items, totals); `true` marks the optional ones (payment,
// notes, signature, terms). An unknown id is simply ignored by the app.
export interface SectionDef {
  id: string;
  label: string;
  hidable: boolean;
  // What data tapping the section edits (APP-007): "customer" | "invoiceDetails" | "items" |
  // "discount" | "notes" | "company" | "none". Optional — absent or an unrecognised value is treated
  // as "none" (shown on the page, absent from the editor list), so a new editor kind ships backend-first.
  edits?: string;
}

// A single control in the app's customisation sheet (APP-005), emitted in display order. `type` is
// "color" (carries `token`), "section" (carries `section`), "template" (no extra field), or a future
// type an older app harmlessly ignores. `title` is the user-facing label; the app falls back to the
// token/section id when it's absent.
export interface CustomisationControl {
  type: string;
  title?: string;
  token?: string;
  section?: string;
}

// The whole compiled document — exactly what GET /templates/:id/compiled returns.
export interface CompiledTemplate {
  schemaVersion: number;
  compilerVersion: number;
  page: PageSetup;
  // Present only when the template declares colour tokens / tags named sections (APP-003). Absent
  // (not empty) when it does not, so an untagged template's bytes are unchanged.
  theme?: Theme;
  sections?: SectionDef[];
  // Optional explicit ordering/labelling of the customisation sheet (APP-005). Absent => the app
  // synthesises today's sheet from `theme.tokens` + `sections`.
  customisation?: CustomisationControl[];
  root: TemplateNode;
}
