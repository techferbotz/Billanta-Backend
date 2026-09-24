import fs from "fs";
import path from "path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { LaidOutPage } from "./layout";

// The ONLY file importing satori (element tree -> SVG, flexbox via yoga) and @resvg/resvg-js
// (SVG -> PNG). Both are pure WASM/native with no system packages, which is why they were chosen
// over headless Chromium: the production box has under 1 GB of RAM shared by several projects.
//
// Both are pinned to exact versions in package.json. A thumbnail's URL embeds a hash of its bytes,
// so an upgrade that shifts a single pixel re-keys every thumbnail on its next render — harmless,
// but it should be a deliberate act, not a side effect of `npm install`.

// <root>/assets/fonts, from both <root>/src/templates/render and <root>/dist/templates/render.
export const FONT_DIR = path.resolve(__dirname, "../../../assets/fonts");

// The app's five bundled families (the compiler admits no others) -> their file prefix.
const FAMILY_FILES: Record<string, string> = {
  Inter: "inter",
  Roboto: "roboto",
  "Open Sans": "opensans",
  Lato: "lato",
  Montserrat: "montserrat",
};

type Weight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

// Lato and Open Sans as distributed carry no ₹ (U+20B9) glyph at all; Inter, Montserrat and Roboto
// do. On a phone the missing glyph comes from the system font, so Roboto — Android's system font —
// is always loaded after the template's own families: satori takes a glyph a face lacks from the
// next face in the list, which reproduces the device's fallback rather than drawing a tofu box.
const FALLBACK_FAMILY = "Roboto";

// Static per-weight faces (satori can't read variable fonts). Only the families the template uses
// (plus the fallback) are loaded: parsed faces are the renderer's biggest memory cost after the
// libraries themselves. No italic faces are bundled — italic renders upright, fine at this scale.
function fontsFor(families: string[]) {
  const files = fs.readdirSync(FONT_DIR).filter((f) => f.endsWith(".ttf")).sort();
  const fonts = [];
  for (const family of [...families.filter((f) => f !== FALLBACK_FAMILY), FALLBACK_FAMILY]) {
    const prefix = FAMILY_FILES[family];
    if (!prefix) continue;
    for (const file of files.filter((f) => f.startsWith(`${prefix}-`))) {
      const weight = Number(/-(\d{3})\.ttf$/.exec(file)?.[1] ?? 400) as Weight;
      fonts.push({ name: family, data: fs.readFileSync(path.join(FONT_DIR, file)), weight, style: "normal" as const });
    }
  }
  if (fonts.length === 0) throw new Error(`no bundled font for ${families.join(", ") || "(none)"}`);
  return fonts;
}

// Rasterise a laid-out page to a PNG exactly `widthPx` wide, at the page's own aspect ratio, on an
// opaque white ground.
export async function rasterize(page: LaidOutPage, widthPx: number): Promise<Buffer> {
  // satori's types ask for a ReactNode; the element tree is that shape, built without React.
  const svg = await satori(page.element as unknown as Parameters<typeof satori>[0], {
    width: page.width,
    height: page.height,
    fonts: fontsFor(page.fontFamilies),
  });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: widthPx }, background: "#ffffff" }).render().asPng();
  return Buffer.from(png);
}
