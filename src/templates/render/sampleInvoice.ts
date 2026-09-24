import { RenderData } from "./layout";

// The one fixed, obviously fictional invoice every template thumbnail is rendered with (APP-012 §1).
//
// Fixed so that re-rendering an unchanged template yields a byte-identical image (and therefore the
// same content-hashed URL), and shared so the thumbnails compare side by side. It populates every
// field in the binding namespace — so whatever sections a template declares, none renders empty —
// plus the images a template may bind (logo, signature, QR), drawn here as SVG so no real mark,
// signature or scannable code ever appears.
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

const BANK = { bankName: "Example Bank", accountNumber: "0042 0042 0042", ifsc: "EXMP0000042" };
const UPI = "kavericraft@example";

export const SAMPLE_INVOICE: RenderData = {
  company: {
    name: "Kaveri Craft Studio",
    gstin: "29ABCDE1234F1Z5",
    addressLine1: "42, 3rd Cross, Indiranagar",
    addressLine2: "HAL 2nd Stage",
    city: "Bengaluru",
    state: "Karnataka",
    stateCode: "29",
    pincode: "560038",
    country: "India",
    phone: "+91 80 4000 0042",
    email: "hello@kavericraft.example",
    logo: LOGO,
    signature: SIGNATURE,
    qr: QR,
    upiId: UPI,
    ...BANK,
  },
  // Registered in the seller's state (29), so an intra-state CGST + SGST split applies — though no
  // template can show it yet: the binding namespace carries one `invoice.tax` total.
  customer: {
    name: "Meridian Home Stores LLP",
    gstin: "29PQRSX5678K1Z3",
    phone: "+91 98450 00042",
    email: "accounts@meridianhome.example",
    addressLine1: "18, MG Road",
    addressLine2: "Ashok Nagar",
    city: "Bengaluru",
    state: "Karnataka",
    stateCode: "29",
    pincode: "560001",
  },
  // Money is integer paise, exactly as on the wire. The face arithmetic holds:
  // 78,500.00 − 2,500.00 + 13,025.00 = 89,025.00, and each tax line is its item at its rate.
  invoice: {
    number: "INV-0042",
    date: "2026-09-01",
    dueDate: "2026-09-15",
    currency: "INR",
    status: "issued",
    subtotal: "7850000",
    discount: "250000",
    tax: "1302500",
    total: "8902500",
    notes: "Thank you for your business. Please quote INV-0042 with your payment.",
  },
  items: [
    { description: "Brand identity design", hsnSac: "998391", quantity: "1", unitPrice: "4500000", taxRate: "18", amount: "4500000" },
    { description: "Printed brochures, A4 (250 pcs)", hsnSac: "4911", quantity: "2", unitPrice: "650000", taxRate: "12", amount: "1300000" },
    { description: "Product photography, half day", hsnSac: "998386", quantity: "1", unitPrice: "1800000", taxRate: "18", amount: "1800000" },
    { description: "Kraft paper gift bags", hsnSac: "4819", quantity: "200", unitPrice: "1250", taxRate: "5", amount: "250000" },
  ],
  payment: { upi: UPI, qr: QR, ...BANK },
  signature: { url: SIGNATURE, name: "Ananya Rao", designation: "Director" },
};
