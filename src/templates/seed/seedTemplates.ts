// Seed invoice templates — real HTML+CSS authored against the supported subset. These are
// simultaneously (a) the starter templates the seed script publishes, and (b) the worked
// examples in docs/TEMPLATE_AUTHORING.md. Every one must compile; see checkSeedTemplates.ts.
//
// Binding namespace available to templates:
//   company.*  customer.*  invoice.* (number,date,dueDate,currency,subtotal,tax,discount,total,notes,status)
//   items[] (description,hsnSac,quantity,unitPrice,taxRate,amount)  payment.* (upi,qr,bankName,accountNumber,ifsc)
//   signature.url

export interface SeedTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  isPremium: boolean;
  html: string;
  css: string;
}

// ---- Classic: a clean, conventional business invoice (free) -------------------------
const CLASSIC: SeedTemplate = {
  id: "classic",
  name: "Classic",
  description: "A clean, conventional invoice with a boxed items table.",
  category: "Business",
  isPremium: false,
  html: `
<div class="page" data-page-size="A4">
  <div class="top">
    <div class="brand">
      <img class="logo" src="{{ company.logo }}" />
      <div>
        <div class="cname">{{ company.name }}</div>
        <div class="muted">{{ company.addressLine1 }}</div>
        <div class="muted">{{ company.city }} {{ company.pincode }}</div>
        <div class="muted" data-if="company.gstin">GSTIN: {{ company.gstin }}</div>
      </div>
    </div>
    <div class="meta">
      <div class="title">INVOICE</div>
      <div class="muted">No. {{ invoice.number }}</div>
      <div class="muted">Date: {{ invoice.date | date }}</div>
      <div class="muted" data-if="invoice.dueDate">Due: {{ invoice.dueDate | date }}</div>
    </div>
  </div>

  <div class="billto">
    <div class="label">Bill To</div>
    <div class="cname">{{ customer.name }}</div>
    <div class="muted">{{ customer.addressLine1 }}</div>
    <div class="muted" data-if="customer.gstin">GSTIN: {{ customer.gstin }}</div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th class="desc">Description</th>
        <th class="num">Qty</th>
        <th class="num">Rate</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr data-repeat="items as item">
        <td>{{ item.description }}</td>
        <td class="num">{{ item.quantity | number }}</td>
        <td class="num">{{ item.unitPrice | currency }}</td>
        <td class="num">{{ item.amount | currency }}</td>
      </tr>
    </tbody>
    <tfoot>
      <tr><td colspan="3" class="num">Subtotal</td><td class="num">{{ invoice.subtotal | currency }}</td></tr>
      <tr><td colspan="3" class="num">Tax</td><td class="num">{{ invoice.tax | currency }}</td></tr>
      <tr class="grand"><td colspan="3" class="num">Total</td><td class="num"><strong>{{ invoice.total | currency }}</strong></td></tr>
    </tfoot>
  </table>

  <div class="pay" data-if="payment.upi">
    <div class="label">Payment</div>
    <div class="muted">UPI: {{ payment.upi }}</div>
    <div class="muted" data-if="payment.bankName">Bank: {{ payment.bankName }} · A/C {{ payment.accountNumber }} · IFSC {{ payment.ifsc }}</div>
  </div>

  <div class="notes" data-if="invoice.notes">{{ invoice.notes }}</div>
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
.items th { background: #2b3648; color: #ffffff; text-align: left; padding: 8px 10px; font-size: 9pt; }
.items th.num { text-align: right; }
.items td { padding: 7px 10px; border-bottom: 1px solid #e7eaf0; }
.items td.num { text-align: right; }
.items tfoot td { border-bottom: 0; }
.grand td { border-top: 2px solid #2b3648; font-size: 12pt; }
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
<div class="page" data-page-size="A4">
  <div class="head">
    <div class="title">Invoice</div>
    <div class="no">{{ invoice.number }}</div>
  </div>
  <div class="row">
    <div>
      <div class="k">From</div>
      <div class="v">{{ company.name }}</div>
      <div class="s">{{ company.city }}</div>
    </div>
    <div>
      <div class="k">To</div>
      <div class="v">{{ customer.name }}</div>
      <div class="s">{{ customer.city }}</div>
    </div>
    <div>
      <div class="k">Date</div>
      <div class="v">{{ invoice.date | date }}</div>
    </div>
  </div>

  <table class="items">
    <thead>
      <tr><th class="desc">Item</th><th class="num">Qty</th><th class="num">Amount</th></tr>
    </thead>
    <tbody>
      <tr data-repeat="items as item">
        <td>{{ item.description }}</td>
        <td class="num">{{ item.quantity | number }}</td>
        <td class="num">{{ item.amount | currency }}</td>
      </tr>
    </tbody>
  </table>

  <div class="total">
    <span class="k">Total due</span>
    <span class="amt">{{ invoice.total | currency }}</span>
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
  <div class="banner">
    <div class="bname">{{ company.name }}</div>
    <div class="binvoice">INVOICE #{{ invoice.number }}</div>
  </div>
  <div class="body">
    <div class="parties">
      <div>
        <div class="k">Billed to</div>
        <div class="v">{{ customer.name }}</div>
        <div class="s">{{ customer.addressLine1 }}</div>
      </div>
      <div class="right">
        <div class="k">Issued</div>
        <div class="v">{{ invoice.date | date }}</div>
      </div>
    </div>

    <table class="items">
      <thead>
        <tr><th>Description</th><th class="num">Qty</th><th class="num">Amount</th></tr>
      </thead>
      <tbody>
        <tr data-repeat="items as item">
          <td>{{ item.description }}</td>
          <td class="num">{{ item.quantity | number }}</td>
          <td class="num">{{ item.amount | currency }}</td>
        </tr>
      </tbody>
    </table>

    <div class="summary">
      <div class="line"><span>Subtotal</span><span>{{ invoice.subtotal | currency }}</span></div>
      <div class="line"><span>Tax</span><span>{{ invoice.tax | currency }}</span></div>
      <div class="line grand"><span>Total</span><span>{{ invoice.total | currency }}</span></div>
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
