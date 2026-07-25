import { LEGAL, legalPage } from "./legalLayout";

// Terms of Service. TEMPLATE — have a lawyer review before launch.
export const TERMS_HTML = legalPage(
  "Terms of Service",
  `
<h1>Terms of Service</h1>
<div class="meta">Effective ${LEGAL.effectiveDate}</div>
<div class="note">This document is a starting template and must be reviewed by a qualified
professional before you publish the app.</div>

<p>These terms govern your use of ${LEGAL.product}, a mobile invoice generator. By using the app you
agree to them.</p>

<h2>The service</h2>
<p>${LEGAL.product} lets you create, customise and share invoices. Core features work offline on
your device. Signing in with Google is optional and enables cloud sync and media storage.</p>

<h2>Your account</h2>
<p>If you sign in, you are responsible for keeping access to your Google account secure. You may
delete your account and cloud data at any time (see <a href="/delete-account">Account &amp; Data
Deletion</a>).</p>

<h2>Your content and responsibilities</h2>
<ul>
  <li>You own the invoices, customer records and business details you create. You are responsible
  for their accuracy.</li>
  <li>You are solely responsible for ensuring your invoices comply with the tax and legal
  requirements that apply to you (including any GST/VAT obligations). ${LEGAL.product} is a
  document tool, not tax, legal or accounting advice.</li>
  <li>You must not use the app for unlawful purposes or to create fraudulent or misleading
  documents.</li>
</ul>

<h2>Calculations</h2>
<p>The app computes invoice totals from the amounts you enter. While we take care to calculate
correctly, you are responsible for reviewing every invoice before you send it. We are not liable
for figures you fail to verify.</p>

<h2>Payments</h2>
<p>${LEGAL.product} does not process payments. Any payment details shown on an invoice (such as a
UPI id or bank details) are information you provide for your customer's convenience; settlement
happens outside the app.</p>

<h2>Availability</h2>
<p>Because the app is offline-first, invoice creation and PDF generation do not depend on our
servers. Cloud sync and media features depend on service availability and may occasionally be
interrupted.</p>

<h2>Intellectual property</h2>
<p>The app, its templates and its software are the property of ${LEGAL.company}. Invoices you
generate with it are yours.</p>

<h2>Disclaimer &amp; limitation of liability</h2>
<p>The service is provided "as is" without warranties of any kind. To the maximum extent permitted
by law, ${LEGAL.company} is not liable for any indirect or consequential damages, or for losses
arising from figures, tax treatment or documents you did not verify.</p>

<h2>Termination</h2>
<p>You may stop using the app at any time and delete your account. We may suspend access for
violations of these terms.</p>

<h2>Changes</h2>
<p>We may update these terms; the effective date above will change when we do.</p>

<h2>Contact</h2>
<p>Questions? Email <a href="mailto:${LEGAL.contactEmail}">${LEGAL.contactEmail}</a>.</p>
`
);
