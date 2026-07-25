import { BindingFormat, BindValue, RepeatBinding, Span, Value } from "./nodes";
import { ValueError } from "./errors";

// Binding extraction. The client never string-templates; the compiler turns every `{{ … }}`
// into a typed BindValue and every text node into a list of literal/binding spans. These
// helpers are pure and location-unaware — they throw ValueError, and the compiler re-throws
// it as a located CompileError (phase "binding").

// A dotted path of identifiers: invoice.number, item.description, items, payment.upi.
const PATH = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;
const FORMATS: BindingFormat[] = ["text", "currency", "date", "number"];

// Segments that are legal identifiers but would climb/mutate the JS prototype chain when the
// client resolves a path by walking obj = obj[segment], or binds a row scope via scope[as].
// The compiler is the ONLY validation boundary (the client trusts the tree), so these are
// rejected here — this is the prototype-pollution class the phase must block.
const RESERVED_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

const assertSafeSegments = (path: string, raw: string): void => {
  for (const segment of path.split(".")) {
    if (RESERVED_SEGMENTS.has(segment)) {
      throw new ValueError(`binding path may not use the reserved name "${segment}" ("${raw}")`);
    }
  }
};

// Validate a binding path, returning it trimmed.
export const validatePath = (raw: string): string => {
  const path = raw.trim();
  if (!PATH.test(path)) {
    throw new ValueError(`invalid binding path "${raw}"`);
  }
  assertSafeSegments(path, raw);
  return path;
};

/**
 * Parse the INNER text of a `{{ … }}` into a BindValue.
 *
 * Grammar: `path [ | format ] [ ?? 'fallback' ]`
 *   - path      a dotted identifier
 *   - format    one of text|currency|date|number (default "text")
 *   - fallback  a quoted string shown when the path resolves empty (default "")
 *
 * The fallback is split off FIRST (on `??`) so a `|` inside a fallback string wouldn't be
 * mistaken for the format separator.
 */
export const parseBindingExpression = (inner: string): BindValue => {
  let rest = inner.trim();
  if (rest.length === 0) throw new ValueError("empty binding {{ }}");

  let fallback = "";
  const fbIndex = rest.indexOf("??");
  if (fbIndex !== -1) {
    const fbRaw = rest.slice(fbIndex + 2).trim();
    const m = /^(['"])(.*)\1$/.exec(fbRaw);
    if (!m) throw new ValueError(`fallback after ?? must be a quoted string (got \`${fbRaw}\`)`);
    fallback = m[2];
    rest = rest.slice(0, fbIndex).trim();
  }

  let format: BindingFormat = "text";
  const pipeIndex = rest.indexOf("|");
  if (pipeIndex !== -1) {
    const fmt = rest.slice(pipeIndex + 1).trim();
    if (!FORMATS.includes(fmt as BindingFormat)) {
      throw new ValueError(`unknown format "${fmt}" (use ${FORMATS.join("|")})`);
    }
    format = fmt as BindingFormat;
    rest = rest.slice(0, pipeIndex).trim();
  }

  return { kind: "bind", path: validatePath(rest), format, fallback };
};

// True if a string contains at least one binding token.
export const hasBinding = (text: string): boolean => /\{\{[^]*?\}\}/.test(text);

/**
 * Tokenize a text run into spans of literal text and bindings.
 *
 * Whitespace in literal chunks is collapsed to single spaces (HTML semantics), so authored
 * indentation/newlines don't leak into the rendered invoice. A chunk that collapses to
 * nothing is dropped. Returns [] when the whole run is insignificant whitespace.
 */
export const parseTextToSpans = (text: string): Span[] => {
  const spans: Span[] = [];
  const re = /\{\{([^]*?)\}\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const pushLiteral = (chunk: string): void => {
    const collapsed = chunk.replace(/\s+/g, " ");
    if (collapsed.length > 0) {
      spans.push({ value: { kind: "literal", text: collapsed } });
    }
  };

  while ((match = re.exec(text)) !== null) {
    pushLiteral(text.slice(lastIndex, match.index));
    spans.push({ value: parseBindingExpression(match[1]) });
    lastIndex = re.lastIndex;
  }
  pushLiteral(text.slice(lastIndex));

  return spans;
};

/**
 * Parse an attribute value that must be EXACTLY one binding — used for `<img src>`, where a
 * literal (external) URL is rejected. Returns the BindValue.
 */
export const parseSingleBinding = (value: string): Value => {
  const trimmed = value.trim();
  const m = /^\{\{([^]*?)\}\}$/.exec(trimmed);
  if (!m) {
    throw new ValueError(`expected a single binding like {{ company.logo }}, got "${value}"`);
  }
  return parseBindingExpression(m[1]);
};

/**
 * Parse a `data-repeat="items as item"` expression into a RepeatBinding.
 * Both the path and the alias are validated as identifiers.
 */
export const parseRepeatExpression = (raw: string): RepeatBinding => {
  const m = /^\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s+as\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*$/.exec(raw);
  if (!m) {
    throw new ValueError(`data-repeat must look like "items as item" (got "${raw}")`);
  }
  // The alias becomes an object key (scope[as] = item) on the client, so guard it against the
  // same prototype-polluting names as a path segment.
  if (RESERVED_SEGMENTS.has(m[2])) {
    throw new ValueError(`data-repeat alias may not be the reserved name "${m[2]}"`);
  }
  return { path: validatePath(m[1]), as: m[2] };
};
