/**
 * Writes the example payloads the app builds and tests against (docs/examples/, copied to the
 * contract folder's backend/examples/). Every file comes out of the REAL code — the forms, the
 * compiler, the DTO parsers and the money rules — so an example can't drift from what the server
 * does. Re-run after any change to fields, forms, the compiler, a seed or a DTO, and commit the diff.
 *
 * Run: npx ts-node src/scripts/generateContractExamples.ts   (or npm run docs:examples)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Company, Customer, Invoice, InvoiceItem, Prisma, Product, Settings } from "@prisma/client";
import { FORMS_DOCUMENT, settingsDefaults } from "../fields/forms";
import { FIELD_IDS } from "../fields/registry";
import { compileTemplate } from "../templates/compile/compiler";
import { SEED_TEMPLATES } from "../templates/seed/seedTemplates";
import { SAMPLE_INVOICE } from "../templates/render/sampleInvoice";
import { renderThumbnailPng, THUMBNAIL_WIDTH } from "../templates/render/renderThumbnail";
import { parseCompanyPut, toCompanyDto } from "../modules/company/dto/company.dto";
import { parseSettingsPatch, toSettingsDto } from "../modules/settings/dto/settings.dto";
import { parseCustomerValues, toCustomerDto } from "../modules/customer/dto/customer.dto";
import { parseProductValues, toProductDto } from "../modules/product/dto/product.dto";
import { parseInvoiceInput, toInvoiceDto } from "../modules/invoice/dto/invoice.dto";
import { buildInvoiceWrite } from "../modules/invoice/service/invoice.service";

const OUT = path.join(__dirname, "../../docs/examples");
const write = (name: string, value: unknown): void => {
  writeFileSync(path.join(OUT, name), `${JSON.stringify(value, null, 2)}\n`);
  console.log(`  wrote docs/examples/${name}`);
};

// Fixed ids and times, so a re-run only changes a file when the contract does.
const USER = "00000000-0000-4000-8000-0000000000aa";
const CUSTOMER_ID = "00000000-0000-4000-8000-000000000042";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000101";
const INVOICE_ID = "00000000-0000-4000-8000-000000000201";
const AT = new Date("2026-09-01T10:00:00.000Z");
const MEDIA = `https://billanta-media.s3.ap-south-1.amazonaws.com/media/${USER}`;

// The sample invoice draws its images as data: URIs (so thumbnails never fetch); a real value is
// the pair POST /media returns.
const realImages = (values: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [id, v] of Object.entries(values)) {
    const isImage = v !== null && typeof v === "object" && !Array.isArray(v) && "url" in (v as object);
    out[id] = isImage ? { url: `${MEDIA}/${id}.webp`, thumbnailUrl: `${MEDIA}/${id}_thumb.webp` } : v;
  }
  return out;
};

// A values map as the JSON column type a Prisma row carries.
const json = (v: Record<string, unknown>): Prisma.JsonObject => v as Prisma.JsonObject;

const ownedBy = (owners: string[]) => (id: string) => owners.includes(FIELD_IDS[id]?.owner);
const pick = (values: Record<string, unknown>, keep: (id: string) => boolean): Record<string, unknown> =>
  Object.fromEntries(Object.entries(values).filter(([id]) => keep(id)));

const main = async (): Promise<void> => {
  mkdirSync(OUT, { recursive: true });
  const sample = realImages(SAMPLE_INVOICE);
  const lines = (SAMPLE_INVOICE.line_items as Record<string, unknown>[]).map((l) =>
    realImages(pick(l, ownedBy(["line"])))
  );

  // --- GET /forms -------------------------------------------------------------------
  write("forms.json", FORMS_DOCUMENT);

  // --- a compiled v2 template (GET /templates/classic/compiled) ----------------------
  const classic = SEED_TEMPLATES.find((t) => t.id === "classic")!;
  const { compiled } = compileTemplate(classic.html, classic.css);
  write("template-classic.compiled.json", compiled);

  // --- the render context the classic tree is drawn with -----------------------------
  write("render-context.json", {
    ...sample,
    line_items: (SAMPLE_INVOICE.line_items as Record<string, unknown>[]).map((l) => realImages(l)),
  });
  writeFileSync(path.join(OUT, "template-classic.thumbnail.png"), await renderThumbnailPng(compiled, THUMBNAIL_WIDTH));
  console.log("  wrote docs/examples/template-classic.thumbnail.png");

  // --- records: request bodies and the responses they produce ------------------------
  const companyValues = parseCompanyPut({ values: pick(sample, ownedBy(["company"])) });
  const company: Company = { id: "c0", userId: USER, values: json(companyValues), createdAt: AT, updatedAt: AT };

  const settingsPatch = { settings_default_tax_rate: "18", settings_default_due_days: "14", settings_default_notes: "Thank you for your business." };
  const settingsValues = { ...settingsDefaults(), ...parseSettingsPatch({ values: settingsPatch }) };
  const settings: Settings = { id: "s0", userId: USER, values: json(settingsValues), createdAt: AT, updatedAt: AT };

  const customerValues = parseCustomerValues({ values: pick(sample, ownedBy(["customer"])) });
  const customer: Customer = {
    id: CUSTOMER_ID, userId: USER, values: json(customerValues),
    name: String(customerValues.customer_name), phone: String(customerValues.customer_phone),
    gstin: String(customerValues.customer_gstin), createdAt: AT, updatedAt: AT,
  };

  // A product is a line without its quantity (that belongs to the line it's added to).
  const productValues = parseProductValues({ values: pick(lines[0], (id) => id !== "quantity") });
  const product: Product = {
    id: PRODUCT_ID, userId: USER, values: json(productValues), name: String(productValues.description),
    createdAt: AT, updatedAt: AT,
  };

  write("records.json", {
    "PUT /company": { request: { values: companyValues }, response: toCompanyDto(company) },
    "PATCH /settings": { request: { values: settingsPatch }, response: toSettingsDto(settings) },
    "POST /customers": { request: { id: CUSTOMER_ID, values: customerValues }, response: toCustomerDto(customer) },
    "POST /products": {
      request: { id: PRODUCT_ID, values: productValues },
      response: toProductDto(product),
    },
  });

  // --- an invoice: the request and exactly what the server answers -------------------
  const request = {
    id: INVOICE_ID,
    templateId: "classic",
    templateVersion: 1,
    status: "Pending",
    // Its own fields plus the COMPLETE company and customer copies (every key, not just the
    // printed ones).
    values: pick(sample, ownedBy(["invoice", "company", "customer"])),
    lineItems: lines.map((values, i) => ({ id: `00000000-0000-4000-8000-0000000003${String(i).padStart(2, "0")}`, values })),
    hiddenSections: ["notes"],
    themeOverrides: { accent: "#0f766e" },
    updatedAt: AT.toISOString(),
  };
  delete (request.values as Record<string, unknown>).line_items;
  const parsed = parseInvoiceInput(request, INVOICE_ID);
  const { data, items } = buildInvoiceWrite(parsed);
  const row: Invoice & { items: InvoiceItem[] } = {
    id: INVOICE_ID,
    userId: USER,
    status: data.status,
    templateId: data.templateId,
    templateVersion: data.templateVersion,
    values: json(data.values),
    invoiceNumber: data.invoiceNumber,
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    themeOverrides: (data.themeOverrides ?? null) as Invoice["themeOverrides"],
    hiddenSections: (data.hiddenSections ?? null) as Invoice["hiddenSections"],
    subtotal: data.subtotal,
    discountTotal: data.discountTotal,
    taxTotal: data.taxTotal,
    grandTotal: data.grandTotal,
    pdfPath: null,
    deletedAt: null,
    createdAt: AT,
    updatedAt: data.updatedAt,
    items: items.map((it, i) => ({ id: `row-${i}`, invoiceId: INVOICE_ID, ...it, values: json(it.values) })),
  };
  write("invoice.json", { "POST /invoices": { request, response: toInvoiceDto(row) } });
};

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
