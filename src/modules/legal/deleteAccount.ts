import { LEGAL, legalPage } from "./legalLayout";

// Account & Data Deletion page. Google Play requires a reachable URL describing how users delete
// their account and data. TEMPLATE — review before launch.
export const DELETE_ACCOUNT_HTML = legalPage(
  "Account & Data Deletion",
  `
<h1>Account &amp; Data Deletion</h1>
<div class="meta">Effective ${LEGAL.effectiveDate}</div>

<p>This page explains how to delete your ${LEGAL.product} account and the data associated with it.</p>

<h2>Delete from within the app (recommended)</h2>
<ol>
  <li>Open ${LEGAL.product} and make sure you are signed in.</li>
  <li>Go to <strong>Settings → Account</strong>.</li>
  <li>Tap <strong>Delete account</strong> and confirm.</li>
</ol>
<p>This immediately and permanently deletes your account.</p>

<h2>Delete by request</h2>
<p>If you cannot access the app, email
<a href="mailto:${LEGAL.contactEmail}">${LEGAL.contactEmail}</a> from the address associated with
your account and ask us to delete your account. We will verify the request and complete deletion.</p>

<h2>What gets deleted</h2>
<ul>
  <li>Your account profile (name, email, Google identifier).</li>
  <li>Your synced invoices and their line items.</li>
  <li>Your customers, company profile and settings.</li>
  <li>Your sign-in sessions (refresh tokens).</li>
</ul>
<p>Deletion is permanent and cannot be undone. Data that exists only on your device is removed by
uninstalling the app or clearing its data from your device settings; uploaded media may be purged
on a routine schedule after account deletion.</p>

<h2>Timeline</h2>
<p>In-app deletion takes effect immediately. Deletion requests by email are completed within a
reasonable period after we verify the request.</p>

<h2>Contact</h2>
<p>Questions about deletion? Email
<a href="mailto:${LEGAL.contactEmail}">${LEGAL.contactEmail}</a>.</p>
`
);
