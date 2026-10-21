// Seed invoice templates — real HTML+CSS authored against the supported subset. These are
// simultaneously (a) the starter templates the seed script publishes, and (b) the worked
// examples in docs/TEMPLATE_AUTHORING.md. Every one must compile; see checkSeedTemplates.ts.
//
// Each section declares the fields its editor shows (data-fields), and everything printed is a
// field id from src/fields/registry.ts — see docs/FIELDS.md. Company and customer fields leave out
// their type and label, which they inherit from the global forms.

export interface SeedTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  isPremium: boolean;
  html: string;
  css: string;
}

// The fields every seed's line-item table edits. description/unit_price/tax_rate inherit their
// type from the product form; quantity isn't on it, so it says its own.
const LINE_COLUMNS = `[
  {"id":"description","label":"Item"},
  {"id":"quantity","type":"number","label":"Qty","min":0,"default":{"kind":"value","value":"1"}},
  {"id":"unit_price","label":"Rate"},
  {"id":"tax_rate","label":"GST %","default":{"kind":"setting","id":"settings_default_tax_rate"}},
  {"id":"line_total","label":"Amount"}
]`;

// ---- Classic: a clean, conventional business invoice (free) -------------------------
const CLASSIC: SeedTemplate = {
  id: "classic",
  name: "Classic",
  description: "A clean, conventional invoice with a boxed items table.",
  category: "Business",
  isPremium: false,
  html: `
<div class="page" data-page-size="A4"
     data-section-order="header business parties items totals payment notes"
     data-customisation='[{"type":"template","title":"Template"},{"type":"color","title":"Accent colour","token":"accent"},{"type":"section","title":"Payment details","section":"payment"},{"type":"section","title":"Notes","section":"notes"}]'>
  <div class="top">
    <div class="brand" data-section="business" data-section-label="Your business" data-hidable="false"
         data-fields='[{"id":"company_logo"},{"id":"company_name"},{"id":"company_address_line1"},{"id":"company_city"},{"id":"company_pincode"},{"id":"company_gstin"}]'>
      <img class="logo" src="{{ company_logo.url }}" data-if="company_logo" />
      <div>
        <div class="cname">{{ company_name }}</div>
        <div class="muted">{{ company_address_line1 }}</div>
        <div class="muted">{{ company_city }} {{ company_pincode }}</div>
        <div class="muted" data-if="company_gstin">GSTIN: {{ company_gstin }}</div>
      </div>
    </div>
    <div class="meta" data-section="header" data-section-label="Invoice details" data-hidable="false"
         data-fields='[{"id":"invoice_number","label":"Invoice number"},{"id":"invoice_date","label":"Date","default":{"kind":"today"}},{"id":"due_date","type":"due_date","label":"Due date","remember":true,"presets":[0,7,15,30],"default":{"kind":"setting","id":"settings_default_due_days"}}]'>
      <div class="title" data-token="color:accent">INVOICE</div>
      <div class="muted">No. {{ invoice_number }}</div>
      <div class="muted">Date: {{ invoice_date | date }}</div>
      <div class="muted" data-if="due_date">Due: {{ due_date | date }}</div>
    </div>
  </div>

  <div class="billto" data-section="parties" data-section-label="Bill to" data-hidable="false"
       data-fields='[{"id":"customer","label":"Customer"},{"id":"customer_name"},{"id":"customer_address_line1"},{"id":"customer_gstin"},{"id":"customer_state"}]'>
    <div class="label">Bill To</div>
    <div class="cname">{{ customer_name }}</div>
    <div class="muted">{{ customer_address_line1 }}</div>
    <div class="muted" data-if="customer_gstin">GSTIN: {{ customer_gstin }}</div>
  </div>

  <div class="itemsblock" data-section="items" data-section-label="Items" data-hidable="false"
       data-fields='[{"id":"line_items","label":"Items","columns":${LINE_COLUMNS}}]'>
  <table class="items" data-if="line_items">
    <thead>
      <tr>
        <th class="desc" data-token="backgroundColor:accent">Description</th>
        <th class="num" data-token="backgroundColor:accent">Qty</th>
        <th class="num" data-token="backgroundColor:accent">Rate</th>
        <th class="num" data-token="backgroundColor:accent">Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr data-repeat="line_items as item">
        <td>{{ item.description }}</td>
        <td class="num">{{ item.quantity | number }}</td>
        <td class="num">{{ item.unit_price | currency }}</td>
        <td class="num">{{ item.line_total | currency }}</td>
      </tr>
    </tbody>
    <tfoot>
      <tr><td colspan="3" class="num">Subtotal</td><td class="num">{{ subtotal | currency }}</td></tr>
      <tr data-if="discount_total"><td colspan="3" class="num">Discount</td><td class="num">-{{ discount_total | currency }}</td></tr>
      <tr><td colspan="3" class="num">Tax</td><td class="num">{{ tax_total | currency }}</td></tr>
      <tr class="grand" data-section="totals" data-section-label="Total" data-hidable="false"
          data-fields='[{"id":"discount","label":"Discount"},{"id":"grand_total","label":"Total"}]'><td colspan="3" class="num" data-token="borderTopColor:accent">Total</td><td class="num" data-token="borderTopColor:accent"><strong>{{ grand_total | currency }}</strong></td></tr>
    </tfoot>
  </table>
  <div class="empty" data-unless="line_items" data-editor-only><div class="emptylabel">+ Add an item</div></div>
  </div>

  <div class="pay" data-section="payment" data-section-label="Payment details"
       data-fields='[{"id":"company_upi_id"},{"id":"company_bank_name"},{"id":"company_bank_account_number"},{"id":"company_bank_ifsc"}]'>
    <div class="label">Payment</div>
    <div class="muted" data-if="company_upi_id">UPI: {{ company_upi_id }}</div>
    <div class="muted" data-if="company_bank_account_number">Bank: {{ company_bank_name }} · A/C {{ company_bank_account_number }} · IFSC {{ company_bank_ifsc }}</div>
  </div>

  <div class="notes" data-section="notes" data-section-label="Notes" data-if="notes"
       data-fields='[{"id":"notes","type":"multiline","label":"Notes","default":{"kind":"setting","id":"settings_default_notes"}}]'>{{ notes }}</div>
</div>`,
  css: `
.page { padding: 44px; font-family: Inter; font-size: 10pt; color: #1f2430; line-height: 1.45; }
.top { display: flex; justify-content: space-between; align-items: flex-start; }
.brand { display: flex; gap: 14px; align-items: center; }
.logo { width: 72px; height: 72px; }
.cname { font-size: 14pt; font-weight: 700; }
.muted { color: #6a7180; font-size: 9pt; }
.meta { text-align: right; }
.title { font-size: 22pt; font-weight: 700; letter-spacing: 2px; color: #2b3648; }
.billto { margin-top: 22px; }
.label { font-size: 8pt; text-transform: uppercase; letter-spacing: 1px; color: #97a0b0; }
.items { width: 100%; margin-top: 18px; }
.items th { background-color: #2b3648; color: #ffffff; text-align: left; padding: 8px 10px; font-size: 9pt; }
.items th.num { text-align: right; }
.items td { padding: 7px 10px; border-bottom: 1px solid #e7eaf0; }
.items td.num { text-align: right; }
.items tfoot td { border-bottom: 0; }
.grand td { border-top: 2px solid #2b3648; font-size: 12pt; }
.empty { margin-top: 18px; padding: 22px; border: 1.5pt dashed #94a3b8; border-radius: 8px; text-align: center; }
.emptylabel { color: #94a3b8; font-size: 10pt; }
.pay { margin-top: 20px; padding: 12px 14px; background-color: #f4f6fa; border-radius: 6px; }
.notes { margin-top: 16px; font-size: 9pt; color: #6a7180; }`,
};

// ---- Minimal: airy, typographic, no table borders (free) ----------------------------
const MINIMAL: SeedTemplate = {
  id: "minimal",
  name: "Minimal",
  description: "An airy, typographic layout with a borderless items list.",
  category: "Minimal",
  isPremium: false,
  html: `
<div class="page" data-page-size="A4" data-token="color:accent" data-customisation='[{"type":"template","title":"Template"},{"type":"color","title":"Colour","token":"accent"}]'>
  <div class="head" data-section="header" data-section-label="Invoice details" data-hidable="false"
       data-fields='[{"id":"invoice_number","label":"Invoice number"},{"id":"invoice_date","label":"Date","default":{"kind":"today"}}]'>
    <div class="title" data-token="color:accent">Invoice</div>
    <div class="no">{{ invoice_number }}</div>
  </div>
  <div class="row" data-section="parties" data-section-label="From and to" data-hidable="false"
       data-fields='[{"id":"company_name"},{"id":"company_city"},{"id":"customer","label":"Customer"},{"id":"customer_name"},{"id":"customer_city"},{"id":"customer_state"}]'>
    <div>
      <div class="k">From</div>
      <div class="v">{{ company_name }}</div>
      <div class="s">{{ company_city }}</div>
    </div>
    <div>
      <div class="k">To</div>
      <div class="v">{{ customer_name }}</div>
      <div class="s">{{ customer_city }}</div>
    </div>
    <div>
      <div class="k">Date</div>
      <div class="v">{{ invoice_date | date }}</div>
    </div>
  </div>

  <table class="items" data-section="items" data-section-label="Items" data-hidable="false"
         data-fields='[{"id":"line_items","label":"Items","columns":${LINE_COLUMNS}}]'>
    <thead>
      <tr><th class="desc" data-token="borderBottomColor:accent">Item</th><th class="num" data-token="borderBottomColor:accent">Qty</th><th class="num" data-token="borderBottomColor:accent">Amount</th></tr>
    </thead>
    <tbody>
      <tr data-repeat="line_items as item">
        <td>{{ item.description }}</td>
        <td class="num">{{ item.quantity | number }}</td>
        <td class="num">{{ item.line_total | currency }}</td>
      </tr>
    </tbody>
  </table>

  <div class="total" data-section="totals" data-section-label="Total" data-hidable="false" data-token="borderTopColor:accent"
       data-fields='[{"id":"discount","label":"Discount"},{"id":"grand_total","label":"Total due"}]'>
    <span class="k">Total due</span>
    <span class="amt">{{ grand_total | currency }}</span>
  </div>
  <div class="thanks">Thank you for your business.</div>
</div>`,
  css: `
.page { padding: 56px; font-family: Inter; font-size: 10pt; color: #222831; }
.head { display: flex; justify-content: space-between; align-items: baseline; }
.title { font-size: 26pt; font-weight: 300; letter-spacing: 3px; text-transform: uppercase; }
.no { font-size: 11pt; color: #9aa2ac; }
.row { display: flex; justify-content: space-between; margin-top: 30px; }
.k { font-size: 8pt; text-transform: uppercase; letter-spacing: 1px; color: #9aa2ac; }
.v { font-size: 11pt; font-weight: 600; }
.s { font-size: 9pt; color: #6a7180; }
.items { width: 100%; margin-top: 34px; }
.items th { text-align: left; padding: 6px 0; border-bottom: 1px solid #222831; font-size: 8pt; text-transform: uppercase; letter-spacing: 1px; color: #6a7180; }
.items th.num { text-align: right; }
.items td { padding: 9px 0; border-bottom: 1px solid #eceef2; }
.items td.num { text-align: right; }
.total { display: flex; justify-content: space-between; align-items: baseline; margin-top: 22px; padding-top: 12px; border-top: 2px solid #222831; }
.amt { font-size: 16pt; font-weight: 700; }
.thanks { margin-top: 40px; text-align: center; font-size: 9pt; color: #9aa2ac; font-style: italic; }`,
};

// ---- Bold: a colored-header premium template ---------------------------------------
const BOLD: SeedTemplate = {
  id: "bold",
  name: "Bold",
  description: "A vivid, colored-header invoice with a summary panel.",
  category: "Premium",
  isPremium: true,
  html: `
<div class="page" data-page-size="A4">
  <div class="banner" data-section="header" data-section-label="Invoice details" data-hidable="false" data-token="backgroundColor:accent"
       data-fields='[{"id":"company_name"},{"id":"invoice_number","label":"Invoice number"},{"id":"invoice_date","label":"Issued","default":{"kind":"today"}}]'>
    <div class="bname">{{ company_name }}</div>
    <div class="binvoice">INVOICE #{{ invoice_number }}</div>
  </div>
  <div class="body">
    <div class="parties" data-section="parties" data-section-label="Billed to" data-hidable="false"
         data-fields='[{"id":"customer","label":"Customer"},{"id":"customer_name"},{"id":"customer_address_line1"},{"id":"customer_state"}]'>
      <div>
        <div class="k">Billed to</div>
        <div class="v">{{ customer_name }}</div>
        <div class="s">{{ customer_address_line1 }}</div>
      </div>
      <div class="right">
        <div class="k">Issued</div>
        <div class="v">{{ invoice_date | date }}</div>
      </div>
    </div>

    <table class="items" data-section="items" data-section-label="Items" data-hidable="false"
           data-fields='[{"id":"line_items","label":"Items","columns":${LINE_COLUMNS}}]'>
      <thead>
        <tr><th data-token="color:accent">Description</th><th class="num" data-token="color:accent">Qty</th><th class="num" data-token="color:accent">Amount</th></tr>
      </thead>
      <tbody>
        <tr data-repeat="line_items as item">
          <td>{{ item.description }}</td>
          <td class="num">{{ item.quantity | number }}</td>
          <td class="num">{{ item.line_total | currency }}</td>
        </tr>
      </tbody>
    </table>

    <div class="summary" data-section="totals" data-section-label="Total" data-hidable="false"
         data-fields='[{"id":"discount","label":"Discount"},{"id":"grand_total","label":"Total"}]'>
      <div class="line"><span>Subtotal</span><span>{{ subtotal | currency }}</span></div>
      <div class="line" data-if="discount_total"><span>Discount</span><span>-{{ discount_total | currency }}</span></div>
      <div class="line"><span>Tax</span><span>{{ tax_total | currency }}</span></div>
      <div class="line grand" data-token="borderTopColor:accent"><span>Total</span><span>{{ grand_total | currency }}</span></div>
    </div>
  </div>
</div>`,
  css: `
.page { padding: 0; font-family: Montserrat; font-size: 10pt; color: #1a1c22; }
.banner { display: flex; justify-content: space-between; align-items: center; padding: 34px 44px; background-color: #4f2ee8; color: #ffffff; }
.bname { font-size: 18pt; font-weight: 700; }
.binvoice { font-size: 11pt; letter-spacing: 2px; }
.body { padding: 34px 44px; }
.parties { display: flex; justify-content: space-between; }
.right { text-align: right; }
.k { font-size: 8pt; text-transform: uppercase; letter-spacing: 1px; color: #8a90a0; }
.v { font-size: 12pt; font-weight: 600; }
.s { font-size: 9pt; color: #6a7180; }
.items { width: 100%; margin-top: 26px; }
.items th { text-align: left; padding: 8px 10px; background-color: #f0edff; color: #4f2ee8; font-size: 9pt; }
.items th.num { text-align: right; }
.items td { padding: 8px 10px; border-bottom: 1px solid #eceef2; }
.items td.num { text-align: right; }
.summary { margin-top: 22px; margin-left: auto; width: 260px; }
.line { display: flex; justify-content: space-between; padding: 6px 0; color: #6a7180; }
.grand { border-top: 2px solid #4f2ee8; color: #1a1c22; font-size: 13pt; font-weight: 700; }`,
};

export const SEED_TEMPLATES: SeedTemplate[] = [CLASSIC, MINIMAL, BOLD];
