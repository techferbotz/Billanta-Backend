import postcss, { Rule, AtRule, Declaration, CssSyntaxError } from "postcss";
import { failAt, ValueError } from "../compile/errors";
import { expandDeclaration } from "./properties";

// CSS parsing + selector/property validation. postcss turns the authored CSS into rules; we
// validate the selectors and expand each declaration into whitelisted longhands, rejecting
// anything outside the subset with an exact location. Value normalization happens later
// (cascade), on the winning declaration only.

// One simple selector: an optional tag plus any number of classes/ids.
export interface SimpleSelector {
  tag?: string;
  id?: string;
  classes: string[];
}

// A compound in the selector chain, tagged with how it relates to the one before it.
export interface CompoundPart {
  combinator: "descendant" | "child";
  simple: SimpleSelector;
}

export interface Selector {
  parts: CompoundPart[]; // left-to-right; parts[0].combinator is "descendant" by convention
  specificity: [number, number, number]; // (id, class, tag) counts
}

export interface RawDeclaration {
  key: string; // camelCase longhand
  value: string; // raw; normalized during cascade
  line?: number;
}

export interface StyleRule {
  selectors: Selector[];
  declarations: RawDeclaration[];
  order: number; // source order, the cascade tiebreaker after specificity
}

// Parse one compound selector like `td.amount` or `#total`. Rejects pseudo-classes/elements,
// attribute selectors, the universal selector and sibling combinators.
const parseCompound = (raw: string, line?: number): SimpleSelector => {
  const compound = raw.trim();
  if (compound.length === 0) {
    failAt("css", "empty selector", line);
  }
  // Reject everything outside tag/./# up front, with a specific message per offender.
  if (compound.includes("*")) failAt("css", `universal selector "*" is not supported`, line);
  if (compound.includes(":")) failAt("css", `pseudo-selectors are not supported ("${raw}")`, line);
  if (compound.includes("[")) failAt("css", `attribute selectors are not supported ("${raw}")`, line);
  if (/[+~]/.test(compound)) failAt("css", `sibling combinators are not supported ("${raw}")`, line);

  const m = /^([a-zA-Z][a-zA-Z0-9]*)?((?:[.#][a-zA-Z0-9_-]+)*)$/.exec(compound);
  if (!m) {
    failAt("css", `unsupported selector "${raw}"`, line);
  }
  const simple: SimpleSelector = { classes: [] };
  if (m![1]) simple.tag = m![1].toLowerCase();
  const tokens = m![2].match(/[.#][a-zA-Z0-9_-]+/g) ?? [];
  for (const tok of tokens) {
    if (tok[0] === "#") {
      if (simple.id) failAt("css", `a selector may have at most one id ("${raw}")`, line);
      simple.id = tok.slice(1);
    } else {
      simple.classes.push(tok.slice(1));
    }
  }
  return simple;
};

// Parse one full selector (a chain of compounds joined by descendant/child combinators).
const parseSelector = (raw: string, line?: number): Selector => {
  // Normalize the child combinator so a whitespace split yields ">" as its own token.
  const tokens = raw.replace(/\s*>\s*/g, " > ").trim().split(/\s+/);

  const parts: CompoundPart[] = [];
  let pendingCombinator: "descendant" | "child" = "descendant";
  for (const tok of tokens) {
    if (tok === ">") {
      pendingCombinator = "child";
      continue;
    }
    parts.push({ combinator: pendingCombinator, simple: parseCompound(tok, line) });
    pendingCombinator = "descendant";
  }
  if (parts.length === 0) failAt("css", `empty selector`, line);

  let id = 0;
  let cls = 0;
  let tag = 0;
  for (const p of parts) {
    if (p.simple.id) id += 1;
    cls += p.simple.classes.length;
    if (p.simple.tag) tag += 1;
  }
  return { parts, specificity: [id, cls, tag] };
};

/**
 * Parse a stylesheet into validated StyleRules.
 *
 * Rejects at-rules (@media/@font-face/@import/@keyframes/…), unsupported selectors, and
 * unsupported properties/values — each with a source location. A CSS syntax error from
 * postcss is surfaced as a located `css: syntax error` rather than a 500.
 */
export const parseCss = (css: string): StyleRule[] => {
  let root;
  try {
    root = postcss.parse(css, { from: undefined });
  } catch (err) {
    if (err instanceof CssSyntaxError) {
      failAt("css", `syntax error: ${err.reason}`, err.line, err.column);
    }
    throw err;
  }

  const rules: StyleRule[] = [];
  let order = 0;

  root.each((node) => {
    if (node.type === "atrule") {
      const at = node as AtRule;
      failAt("css", `unsupported at-rule "@${at.name}"`, at.source?.start?.line);
    }
    if (node.type !== "rule") return; // comments, stray decls: ignore
    const rule = node as Rule;
    const selLine = rule.source?.start?.line;
    const selectors = rule.selectors.map((s) => parseSelector(s, selLine));

    const declarations: RawDeclaration[] = [];
    rule.each((child) => {
      if (child.type !== "decl") return;
      const decl = child as Declaration;
      const line = decl.source?.start?.line;
      try {
        for (const lh of expandDeclaration(decl.prop, decl.value)) {
          declarations.push({ key: lh.key, value: lh.value, line });
        }
      } catch (err) {
        if (err instanceof ValueError) {
          failAt("css", `${err.message} in rule "${rule.selector}"`, line);
        }
        throw err;
      }
    });

    rules.push({ selectors, declarations, order: order++ });
  });

  return rules;
};

/**
 * Parse an inline `style="..."` attribute into longhand declarations. Errors are thrown as
 * ValueError (the compiler adds the element's location), since inline styles have no rule.
 */
export const parseInlineStyle = (style: string): RawDeclaration[] => {
  const out: RawDeclaration[] = [];
  for (const part of style.split(";")) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) throw new ValueError(`malformed inline style "${trimmed}"`);
    const prop = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    for (const lh of expandDeclaration(prop, value)) {
      out.push({ key: lh.key, value: lh.value });
    }
  }
  return out;
};
