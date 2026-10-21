import { RenderData } from "./layout";
import { calculateInvoice, deriveGstSplit } from "../../common/money";

// The one fixed, obviously fictional invoice every template thumbnail is rendered with (APP-012 §1).
//
// Fixed so that re-rendering an unchanged template yields a byte-identical image (and therefore the
// same content-hashed URL), and shared so the thumbnails compare side by side. It populates every
// registered field (check:thumbnails asserts it) — so whatever fields a template lists, none renders
// empty — including the images a template may bind (logo, signature, QR), drawn here as SVG so no
// real mark, signature or scannable code ever appears.
//
// Keep it fictional: `.example` domains (RFC 2606), "Example Bank", documentation-style GSTINs.
// Changing any value re-renders every thumbnail on its next generation, which is fine — the URL
// changes with the bytes, so no client is left holding a stale image.

const svg = (markup: string): string => `data:image/svg+xml;base64,${Buffer.from(markup).toString("base64")}`;

// A neutral slate mark, so it sits comfortably on any template's palette.
const LOGO = svg(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">` +
    `<rect x="6" y="6" width="108" height="108" rx="26" fill="#2f3a4a"/>` +
    `<path d="M36 84 V36 L60 62 L84 36 V84" fill="none" stroke="#ffffff" stroke-width="10" ` +
    `stroke-linecap="round" stroke-linejoin="round"/></svg>`
);

// A cursive-looking ink stroke — nobody's signature.
const SIGNATURE = svg(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100">` +
    `<path d="M14 70 C 30 20, 48 20, 46 58 S 62 88, 78 50 S 96 18, 104 56 C 110 80, 124 74, 132 52 ` +
    `C 140 30, 152 34, 150 60 C 148 78, 170 72, 180 50 C 190 30, 204 40, 200 62 C 198 74, 214 70, 226 56 ` +
    `C 238 42, 250 48, 262 54 L 288 50" fill="none" stroke="#1d2a6b" stroke-width="4" ` +
    `stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M40 84 C 110 74, 190 76, 270 70" fill="none" stroke="#1d2a6b" stroke-width="2.5" ` +
    `stroke-linecap="round"/></svg>`
);

// A QR-style block: three finder squares and a seeded fill. Decorative, not a decodable code.
const QR = (() => {
  const n = 25;
  const cell = 8;
  let seed = 42;
  const next = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
  const inFinder = (x: number, y: number) =>
    (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
  const square = (x: number, y: number, size: number, fill: string) =>
    `<rect x="${x * cell}" y="${y * cell}" width="${size * cell}" height="${size * cell}" fill="${fill}"/>`;
  const finder = (x: number, y: number) =>
    square(x, y, 7, "#111111") + square(x + 1, y + 1, 5, "#ffffff") + square(x + 2, y + 2, 3, "#111111");
  let dots = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) if (!inFinder(x, y) && next() < 0.46) dots += square(x, y, 1, "#111111");
  }
  return svg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n * cell} ${n * cell}">` +
      `<rect width="100%" height="100%" fill="#ffffff"/>${dots}${finder(0, 0)}${finder(n - 7, 0)}${finder(0, n - 7)}</svg>`
  );
})();

// A plain product swatch, for templates that show a photo on each line.
const PHOTO = svg(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="10" fill="#e4e8ee"/>` +
    `<path d="M14 46 L27 30 L36 40 L42 33 L50 46 Z" fill="#a9b3c1"/><circle cx="44" cy="22" r="5" fill="#a9b3c1"/></svg>`
);

const image = (url: string) => ({ url, thumbnailUrl: url });

// The lines, as the line values a real invoice stores (money is integer paise, as on the wire).
const LINES = [
  { description: "Brand identity design", image: image(PHOTO), hsn_sac: "998391", unit: "job", quantity: "1", unit_price: "4500000", tax_rate: "18" },
  { description: "Printed brochures, A4 (250 pcs)", image: image(PHOTO), hsn_sac: "4911", unit: "pack", quantity: "2", unit_price: "650000", tax_rate: "12" },
  { description: "Product photography, half day", image: image(PHOTO), hsn_sac: "998386", unit: "session", quantity: "1", unit_price: "1800000", tax_rate: "18" },
  { description: "Kraft paper gift bags", image: image(PHOTO), hsn_sac: "4819", unit: "pcs", quantity: "200", unit_price: "1250", tax_rate: "5" },
];

// A flat ₹2,500 off the total, after tax. The totals come from the real money rules, so the face
// arithmetic always holds: 78,500.00 + 13,025.00 − 2,500.00 = 89,025.00.
const DISCOUNT = { kind: "flat", value: "250000", beforeTax: false };
const TOTALS = calculateInvoice(
  LINES.map((l) => ({ quantity: l.quantity, unitPrice: Number(l.unit_price), taxRatePercent: l.tax_rate })),
  { type: "Flat", value: DISCOUNT.value },
  { discountBeforeTax: DISCOUNT.beforeTax }
);
// Seller and buyer are both in Karnataka (29), so the tax splits into CGST + SGST.
const SPLIT = deriveGstSplit(TOTALS.taxTotal, "29", "29");

// The render context (docs/FIELDS.md §8.1): every registered field with a value.
export const SAMPLE_INVOICE: RenderData = {
  // --- business profile ---
  company_name: "Kaveri Craft Studio",
  company_logo: image(LOGO),
  company_gstin: "29ABCDE1234F1Z5",
  company_pan: "ABCDE1234F",
  company_address_line1: "42, 3rd Cross, Indiranagar",
  company_address_line2: "HAL 2nd Stage",
  company_city: "Bengaluru",
  company_state: "29",
  company_pincode: "560038",
  company_country: "India",
  company_phone: "+91 80 4000 0042",
  company_email: "hello@kavericraft.example",
  company_website: "kavericraft.example",
  company_bank_name: "Example Bank",
  company_bank_account_name: "Kaveri Craft Studio",
  company_bank_account_number: "0042 0042 0042",
  company_bank_ifsc: "EXMP0000042",
  company_bank_branch: "Indiranagar",
  company_upi_id: "kavericraft@example",
  company_upi_qr: image(QR),
  company_signature: image(SIGNATURE),
  company_signatory_name: "Ananya Rao",
  company_signatory_designation: "Director",

  // --- customer ---
  customer: "00000000-0000-4000-8000-000000000042",
  customer_name: "Meridian Home Stores LLP",
  customer_contact_person: "Rohan Mehta",
  customer_phone: "+91 98450 00042",
  customer_email: "accounts@meridianhome.example",
  customer_gstin: "29PQRSX5678K1Z3",
  customer_address_line1: "18, MG Road",
  customer_address_line2: "Ashok Nagar",
  customer_city: "Bengaluru",
  customer_state: "29",
  customer_pincode: "560001",
  customer_country: "India",

  // --- invoice ---
  invoice_number: "INV-0042",
  invoice_date: "2026-09-01",
  due_date: "2026-09-15",
  currency: "INR",
  po_number: "PO-7781",
  discount: DISCOUNT,
  notes: "Thank you for your business. Please quote INV-0042 with your payment.",
  terms: "Payment due within 14 days. Goods once sold are not returnable.",
  hide_gst_column: false,
  line_items: LINES.map((l, i) => ({
    ...l,
    line_total: String(TOTALS.lines[i].lineTotal),
    tax_amount: String(TOTALS.lines[i].taxAmount),
  })),

  // --- calculated ---
  subtotal: String(TOTALS.subtotal),
  discount_total: String(TOTALS.discountTotal),
  tax_total: String(TOTALS.taxTotal),
  cgst_total: String(SPLIT.cgst),
  sgst_total: String(SPLIT.sgst),
  igst_total: String(SPLIT.igst),
  grand_total: String(TOTALS.grandTotal),
};
