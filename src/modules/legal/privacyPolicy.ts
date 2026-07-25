import { LEGAL, legalPage } from "./legalLayout";

// Privacy Policy. Reflects Billanta's ACTUAL data practices: offline-first, optional sign-in,
// cloud sync only for signed-in users, no ads, no data selling, no payment processing.
// TEMPLATE — have a lawyer review before launch.
export const PRIVACY_POLICY_HTML = legalPage(
  "Privacy Policy",
  `
<h1>Privacy Policy</h1>
<div class="meta">Effective ${LEGAL.effectiveDate}</div>
<div class="note">This document is a starting template and must be reviewed by a qualified
professional, and its details confirmed, before you publish the app.</div>

<p>${LEGAL.product} is a mobile invoice generator. It is <strong>offline-first</strong>: creating
invoices, choosing templates, generating PDFs and searching all work on your device without an
account. Signing in with Google is optional and only enables cloud features. This policy explains
what we collect and why.</p>

<h2>Information we collect</h2>
<ul>
  <li><strong>Only if you sign in with Google:</strong> your Google account identifier, email
  address, name, and profile photo URL, used to create and identify your account.</li>
  <li><strong>Your business data, only when you are signed in and sync is used:</strong> the
  invoices, customers, company profile and settings you create. Until you sign in, this data stays
  on your device and is never sent to us.</li>
  <li><strong>Media you upload</strong> (business logo, signature, payment QR image), stored so it
  can appear on your invoices.</li>
  <li><strong>Basic technical data</strong> needed to operate the service, such as the device/user
  agent associated with a sign-in session.</li>
</ul>
<p>We do <strong>not</strong> collect payment card details, and ${LEGAL.product} does not process
payments. We do not show ads and we do not sell your data.</p>

<h2>How we use your information</h2>
<ul>
  <li>To provide cloud sync of your invoices, customers, company profile and settings across your
  devices.</li>
  <li>To store and serve media you upload for use on your invoices.</li>
  <li>To authenticate you and keep your session secure.</li>
</ul>

<h2>How your data is stored</h2>
<p>Account and business data is stored in our database on our server. Uploaded media is stored in
Amazon Web Services (AWS) object storage. Access is scoped to your account: your data is only ever
returned to you.</p>

<h2>Third parties</h2>
<ul>
  <li><strong>Google</strong> — for Google Sign-In (only if you choose to sign in).</li>
  <li><strong>Amazon Web Services</strong> — for hosting and media storage.</li>
</ul>
<p>We share your information with these providers only as needed to run the service. We do not sell
or rent your personal information to anyone.</p>

<h2>Data retention and deletion</h2>
<p>You can delete your account and all associated cloud data at any time from within the app, or by
following <a href="/delete-account">Account &amp; Data Deletion</a>. Deleting your account
permanently removes your profile, invoices, customers, settings and refresh tokens from our
systems. Data that lives only on your device is removed by uninstalling the app or clearing its
data.</p>

<h2>Security</h2>
<p>Traffic is encrypted in transit (HTTPS). Sign-in tokens are stored only as hashes, never in
plain text. Access to your data is always scoped to your account.</p>

<h2>Children</h2>
<p>${LEGAL.product} is intended for business use and is not directed at children.</p>

<h2>Changes</h2>
<p>We may update this policy; material changes will be reflected by a new effective date on this
page.</p>

<h2>Contact</h2>
<p>Questions about this policy? Email <a href="mailto:${LEGAL.contactEmail}">${LEGAL.contactEmail}</a>.</p>
`
);
