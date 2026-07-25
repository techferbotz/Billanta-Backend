import { ValueError } from "../compile/errors";

// Color normalization. The renderer only ever sees one canonical form — lowercase
// "#rrggbb" or "#rrggbbaa" — so it never parses rgb()/named/#rgb itself. Everything the CSS
// subset allows is folded into that here.

// A pragmatic set of CSS named colors an invoice designer might reach for. A name outside
// this set is a clear ValueError with a "use a hex code" nudge — better than silently
// shipping a color the renderer can't map. Extend as real templates need more.
const NAMED: Record<string, string> = {
  transparent: "#00000000",
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  navy: "#000080",
  teal: "#008080",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  lightgray: "#d3d3d3",
  lightgrey: "#d3d3d3",
  darkgray: "#a9a9a9",
  darkgrey: "#a9a9a9",
  gainsboro: "#dcdcdc",
  whitesmoke: "#f5f5f5",
  orange: "#ffa500",
  gold: "#ffd700",
  yellow: "#ffff00",
  purple: "#800080",
  maroon: "#800000",
  olive: "#808000",
  lime: "#00ff00",
  aqua: "#00ffff",
  cyan: "#00ffff",
  fuchsia: "#ff00ff",
  magenta: "#ff00ff",
  crimson: "#dc143c",
  slategray: "#708090",
  slategrey: "#708090",
  dimgray: "#696969",
  dimgrey: "#696969",
  steelblue: "#4682b4",
  royalblue: "#4169e1",
  midnightblue: "#191970",
  seagreen: "#2e8b57",
  forestgreen: "#228b22",
  darkgreen: "#006400",
  tomato: "#ff6347",
  coral: "#ff7f50",
  salmon: "#fa8072",
  indigo: "#4b0082",
  beige: "#f5f5dc",
  ivory: "#fffff0",
  snow: "#fffafa",
};

// 0-255 -> two lowercase hex digits.
const hex2 = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

// A 0-1 alpha -> two hex digits.
const alphaHex = (a: number): string => hex2(Math.max(0, Math.min(1, a)) * 255);

const expandShortHex = (h: string): string =>
  h.length === 3 || h.length === 4
    ? h.split("").map((c) => c + c).join("")
    : h;

/**
 * Normalize any supported color to "#rrggbb" or "#rrggbbaa" (lowercase).
 *
 * Accepts: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(r,g,b), rgba(r,g,b,a), and the named colors
 * above. An 8-digit result (alpha) is kept only when the color is actually translucent;
 * a fully-opaque color always collapses to 6 digits, so equivalent inputs (red, #f00,
 * #ff0000, rgb(255,0,0)) all produce the SAME canonical output — which matters for the
 * determinism/checksum guarantee.
 */
export const normalizeColor = (raw: string): string => {
  const value = raw.trim().toLowerCase();

  if (value in NAMED) return collapseOpaque(NAMED[value]);

  if (value.startsWith("#")) {
    const h = value.slice(1);
    if (!/^[0-9a-f]+$/.test(h) || ![3, 4, 6, 8].includes(h.length)) {
      throw new ValueError(`invalid hex color "${raw}"`);
    }
    return collapseOpaque(`#${expandShortHex(h)}`);
  }

  const rgbMatch = /^rgba?\(([^)]+)\)$/.exec(value);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(",").map((p) => p.trim());
    if (parts.length !== 3 && parts.length !== 4) {
      throw new ValueError(`invalid rgb()/rgba() color "${raw}"`);
    }
    const [r, g, b] = parts.slice(0, 3).map(Number);
    if ([r, g, b].some((n) => !Number.isFinite(n))) {
      throw new ValueError(`invalid rgb() component in "${raw}"`);
    }
    const a = parts.length === 4 ? Number(parts[3]) : 1;
    if (!Number.isFinite(a)) throw new ValueError(`invalid alpha in "${raw}"`);
    return collapseOpaque(`#${hex2(r)}${hex2(g)}${hex2(b)}${alphaHex(a)}`);
  }

  throw new ValueError(`unrecognized color "${raw}" (use a hex code like #1a1a1a)`);
};

// Drop a trailing "ff" alpha so opaque colors are always 6 digits — canonical + deterministic.
const collapseOpaque = (hex: string): string =>
  hex.length === 9 && hex.endsWith("ff") ? hex.slice(0, 7) : hex;
