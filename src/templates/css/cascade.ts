import { ResolvedStyle } from "../compile/nodes";
import { failAt, ValueError } from "../compile/errors";
import { AuthoredElement } from "../html/parser";
import { StyleRule, Selector, SimpleSelector, parseInlineStyle } from "./parser";
import { PROPERTY_ORDER, INHERITED, normalizeValue } from "./properties";

// The cascade. Given the authored tree and the parsed rules, it computes ONE fully-resolved,
// absolute style per element: match selectors -> order by (specificity, source order) -> let
// inline styles win -> inherit inheritable properties down the tree -> normalize every value.
// The client renderer receives the result and does none of this.

// A raw winning value plus the source line it came from (for precise value-error reporting).
interface RawValue {
  value: string;
  line?: number;
}

// element attribute helpers
const idOf = (el: AuthoredElement): string | undefined => el.attrs.get("id");
const classesOf = (el: AuthoredElement): string[] => {
  const raw = el.attrs.get("class");
  return raw ? raw.trim().split(/\s+/) : [];
};

// Does a single compound selector match this element (ignoring combinators)?
const simpleMatches = (s: SimpleSelector, el: AuthoredElement): boolean => {
  if (s.tag && s.tag !== el.tag) return false;
  if (s.id && s.id !== idOf(el)) return false;
  if (s.classes.length) {
    const classes = classesOf(el);
    for (const c of s.classes) if (!classes.includes(c)) return false;
  }
  return true;
};

/**
 * Right-to-left selector matching with BACKTRACKING. The rightmost compound must match `el`;
 * each compound to its left must match an ancestor per its combinator — `child` the immediate
 * parent, `descendant` any ancestor further up. `ancestors` is root-first (…grandparent, parent).
 *
 * A greedy single pointer is wrong: for `.card > .row .cell`, the descendant step for `.row`
 * must be free to skip an inner `.row` and match an outer one so the `.card >` child step can
 * still succeed. So descendant steps try every admissible ancestor and recurse, memoizing
 * (partIndex, ancestorPos) to stay polynomial on adversarial selectors.
 */
const selectorMatches = (
  selector: Selector,
  el: AuthoredElement,
  ancestors: AuthoredElement[]
): boolean => {
  const parts = selector.parts;
  const last = parts.length - 1;
  if (!simpleMatches(parts[last].simple, el)) return false;

  // memo[k][pos] caches whether parts[k-1..0] can be matched within ancestors[0..pos-1].
  const memo = new Map<number, boolean>();
  const key = (k: number, pos: number): number => k * (ancestors.length + 1) + pos;

  // Can we match parts[k-1..0] into ancestors[0..pos-1]? (k is the index whose LEFT neighbor
  // we still need to place; parts[k].combinator relates parts[k] to parts[k-1].)
  const match = (k: number, pos: number): boolean => {
    if (k === 0) return true; // nothing left to match
    const cached = memo.get(key(k, pos));
    if (cached !== undefined) return cached;

    const combinator = parts[k].combinator;
    const target = parts[k - 1].simple;
    let result = false;
    if (combinator === "child") {
      // parts[k-1] must be the immediate parent, ancestors[pos-1].
      result = pos - 1 >= 0 && simpleMatches(target, ancestors[pos - 1]) && match(k - 1, pos - 1);
    } else {
      // descendant: try each ancestor above `pos`, backtracking.
      for (let p = pos - 1; p >= 0; p--) {
        if (simpleMatches(target, ancestors[p]) && match(k - 1, p)) {
          result = true;
          break;
        }
      }
    }
    memo.set(key(k, pos), result);
    return result;
  };

  return match(last, ancestors.length);
};

// Compare specificity tuples (id, class, tag) lexicographically.
const specCmp = (a: [number, number, number], b: [number, number, number]): number =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// Collect this element's winning raw declarations (matched rules + inline), keyed by longhand.
const rawDeclarationsFor = (
  el: AuthoredElement,
  ancestors: AuthoredElement[],
  rules: StyleRule[]
): Map<string, RawValue> => {
  // Each matching rule contributes once, at its best-matching selector's specificity.
  const contributions: { spec: [number, number, number]; order: number; rule: StyleRule }[] = [];
  for (const rule of rules) {
    let best: [number, number, number] | null = null;
    for (const sel of rule.selectors) {
      if (selectorMatches(sel, el, ancestors)) {
        if (!best || specCmp(sel.specificity, best) > 0) best = sel.specificity;
      }
    }
    if (best) contributions.push({ spec: best, order: rule.order, rule });
  }
  // Apply low -> high, so the winner (higher specificity, or later source order) lands last.
  contributions.sort((a, b) => specCmp(a.spec, b.spec) || a.order - b.order);

  const map = new Map<string, RawValue>();
  for (const c of contributions) {
    for (const decl of c.rule.declarations) {
      map.set(decl.key, { value: decl.value, line: decl.line });
    }
  }

  // Inline style wins over every rule.
  const inline = el.attrs.get("style");
  if (inline) {
    try {
      for (const decl of parseInlineStyle(inline)) {
        map.set(decl.key, { value: decl.value, line: el.line });
      }
    } catch (err) {
      if (err instanceof ValueError) failAt("css", `${err.message} (inline style)`, el.line);
      throw err;
    }
  }
  return map;
};

// Normalize an effective raw map into a ResolvedStyle, emitting keys in the fixed
// PROPERTY_ORDER for byte-stable output.
const normalize = (effective: Map<string, RawValue>, el: AuthoredElement): ResolvedStyle => {
  const style: ResolvedStyle = {};
  for (const key of PROPERTY_ORDER) {
    const raw = effective.get(key);
    if (!raw) continue;
    try {
      style[key] = normalizeValue(key, raw.value);
    } catch (err) {
      if (err instanceof ValueError) {
        failAt("css", `${err.message} for "${key}"`, raw.line ?? el.line);
      }
      throw err;
    }
  }
  return style;
};

/**
 * Resolve the whole tree top-down, returning each element's absolute ResolvedStyle.
 *
 * Inheritance is threaded as `inherited`: a map of the inheritable keys' raw winning values
 * from the ancestor chain. An element seeds its effective style from that, lets its own
 * declarations override, keeps the inheritable subset, and passes it to its children — so the
 * compiler never re-derives inheritance and the renderer never sees it at all.
 */
export const resolveStyles = (
  root: AuthoredElement,
  rules: StyleRule[]
): Map<AuthoredElement, ResolvedStyle> => {
  const out = new Map<AuthoredElement, ResolvedStyle>();

  const walk = (
    el: AuthoredElement,
    ancestors: AuthoredElement[],
    inherited: Map<string, RawValue>
  ): void => {
    const own = rawDeclarationsFor(el, ancestors, rules);

    // Effective = inherited baseline (inheritable keys only), overridden by own declarations.
    const effective = new Map<string, RawValue>(inherited);
    for (const [key, val] of own) effective.set(key, val);

    out.set(el, normalize(effective, el));

    // What children inherit: the inheritable keys of the effective map.
    const childInherited = new Map<string, RawValue>();
    for (const [key, val] of effective) {
      if (INHERITED.has(key)) childInherited.set(key, val);
    }

    const nextAncestors = [...ancestors, el];
    for (const child of el.children) {
      if (child.type === "element") walk(child, nextAncestors, childInherited);
    }
  };

  walk(root, [], new Map());
  return out;
};
