import { PX_TO_PT } from "../compile/nodes";
import { ValueError } from "../compile/errors";

// Unit normalization. The client renderer never converts units, so the compiler resolves
// every length to ABSOLUTE POINTS here — or rejects it. Percentages are the one exception:
// they are a layout relationship the renderer resolves against a parent at render time, so
// they pass through as a "50%" string (only where a percent is meaningful, e.g. width).

const round2 = (n: number): number => Math.round(n * 100) / 100;

// Parse a CSS length into points, or a percentage string.
//
// Supported: px (× 0.75), pt (as-is), a unitless 0. Percentages allowed only when
// `allowPercent` (width/height/min/max). Everything else — em, rem, vw, vh, %, calc() where
// disallowed — is a ValueError, because the client cannot resolve them without a cascade
// context it deliberately doesn't have.
export const parseLength = (
  raw: string,
  allowPercent = false,
  allowAuto = false
): number | string => {
  const value = raw.trim().toLowerCase();

  // `auto` is meaningful for margins and width/height (the renderer resolves it); it is
  // rejected elsewhere (there is no such thing as padding: auto in this model).
  if (value === "auto") {
    if (allowAuto) return "auto";
    throw new ValueError(`"auto" is not allowed here`);
  }

  if (value === "0") return 0;

  if (value.endsWith("%")) {
    if (!allowPercent) {
      throw new ValueError(`percentage not allowed here ("${raw}")`);
    }
    const n = Number(value.slice(0, -1));
    if (!Number.isFinite(n)) throw new ValueError(`invalid percentage "${raw}"`);
    return `${round2(n)}%`;
  }

  if (value.endsWith("px")) {
    const n = Number(value.slice(0, -2));
    if (!Number.isFinite(n)) throw new ValueError(`invalid length "${raw}"`);
    return round2(n * PX_TO_PT);
  }

  if (value.endsWith("pt")) {
    const n = Number(value.slice(0, -2));
    if (!Number.isFinite(n)) throw new ValueError(`invalid length "${raw}"`);
    return round2(n);
  }

  // A bare number is treated as px (CSS would call this invalid for most props, but authors
  // routinely omit the unit; assuming px is the least surprising).
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return round2(Number(value) * PX_TO_PT);
  }

  if (value.includes("calc(")) {
    throw new ValueError(`calc() is not supported ("${raw}")`);
  }
  throw new ValueError(`unsupported unit in "${raw}" (use px or pt)`);
};

// line-height is special: a UNITLESS value is a multiplier (1.4 = 140% of font size) and is
// preserved as-is for the renderer; a px/pt value resolves to points. `normal` maps to the
// conventional 1.2 multiplier so the client always gets a number.
export const parseLineHeight = (raw: string): number => {
  const value = raw.trim().toLowerCase();
  if (value === "normal") return 1.2;
  if (/^-?\d+(\.\d+)?$/.test(value)) return round2(Number(value)); // unitless multiplier
  const asLength = parseLength(value, false);
  if (typeof asLength !== "number") throw new ValueError(`invalid line-height "${raw}"`);
  return asLength;
};

// opacity: a unitless 0-1 number. Clamped, so a malformed value can't produce an invalid tree.
export const parseOpacity = (raw: string): number => {
  const n = Number(raw.trim());
  if (!Number.isFinite(n)) throw new ValueError(`invalid opacity "${raw}"`);
  return Math.max(0, Math.min(1, round2(n)));
};

// font-weight: normalize the keywords to numbers so the client only ever sees 100-900.
export const parseFontWeight = (raw: string): number => {
  const value = raw.trim().toLowerCase();
  if (value === "normal") return 400;
  if (value === "bold") return 700;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 1000) {
    throw new ValueError(`invalid font-weight "${raw}"`);
  }
  return Math.round(n);
};
