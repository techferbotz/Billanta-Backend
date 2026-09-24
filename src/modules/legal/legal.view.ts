import { config } from "../../config/env";

/**
 * Legal page content — Privacy Policy, Terms & Conditions, and the account-deletion page.
 * HOA protocol 12. These are the URLs on the Google Play listing, and the app opens them from the
 * `links.*` it receives in GET /config (remoteConfig.defaults.ts builds those from LEGAL_PATHS).
 *
 * THE RULE: only claim what the code does. Every data category, processor and retention period
 * below was checked against the codebase and the production box on 2026-09-24:
 *   - data categories   = prisma/schema.prisma (User, Company, Customer, Product, Invoice + items,
 *                         Settings, RefreshToken) and POST /media (images only, never PDFs)
 *   - processors        = Google (Sign-In; ferbotz.com mail is Google Workspace) and AWS (EC2 host
 *                         + database, S3 media — region ap-south-1, Mumbai)
 *   - deletion          = DELETE /users/me cascades every user-owned table; it does NOT touch S3,
 *                         so uploaded images survive it (disclosed on purpose — see below)
 *   - soft deletes      = invoices are tombstoned (deletedAt) for sync; customers/products are
 *                         hard-deleted
 *   - logs              = nginx access log (IP, time, request line, status, user agent), rotated
 *                         daily and kept 14 files (/etc/logrotate.d/nginx); the app's own request log
 *                         (requestLogger: method, URL, status, timing — no IP, no headers) lives in
 *                         the container's json-file log and goes when the container is recreated
 *   - X-App-* / X-Device-Id headers are read by GET /config and never stored or logged
 *   - encryption at rest: S3 yes (AES-256 default). The database volume is NOT encrypted — so
 *                         the pages must not claim it is
 *   - no backups exist, so nothing lingers after deletion (there is deliberately no backup line)
 * When data handling changes, change these pages IN THE SAME COMMIT, bump the effective date, and
 * run `npm run check:legal`.
 *
 * Starting templates, not legal advice: have them reviewed before relying on them.
 */

// ── Shared across all documents (edit in one place) ──
export const LEGAL_APP_NAME = "Billanta";
// The developer name exactly as it appears on the Google Play listing — the delete-account page
// must match the listing (Play requirement). Confirmed by the owner 2026-09-24.
export const LEGAL_COMPANY = "Ferbotz";
// The single contact address: all three pages, the store listing, and links.supportEmail in
// GET /config (imported there — never retype it). Google Workspace inbox.
export const LEGAL_CONTACT_EMAIL = "support@ferbotz.com";

// ── Per-document — bump on every material change ──
export const PRIVACY_EFFECTIVE_DATE = "24 September 2026";
export const TERMS_EFFECTIVE_DATE = "24 September 2026";
export const DELETE_ACCOUNT_EFFECTIVE_DATE = "24 September 2026";
export const TERMS_GOVERNING_LAW = "India";
// Billanta is a business tool; this is also the age India's DPDP Act treats as adulthood.
export const MIN_AGE_YEARS = 18;

// ── Public promises quoted on the pages ──
// Change the operational reality and these constants together, never one alone.
/** Deadline for an emailed request: account deletion, image removal, or a data-rights request. */
export const REQUEST_RESPONSE_DAYS = 30;
/** Web-server (nginx) access logs: rotated daily, 14 kept — mirrors /etc/logrotate.d/nginx on the box. */
export const SERVER_LOG_RETENTION_DAYS = 14;
/** A sign-in session's lifetime — imported from what the auth module actually enforces. */
export const SESSION_LIFETIME_DAYS = config.refreshTokenTtlDays;

// ── Public paths ──
// The routes register these (plus aliases), the pages cross-link with them, and GET /config
// builds its absolute `links.*` from config.publicUrl + these. One definition, three consumers.
export const LEGAL_PATHS = {
  privacy: "/privacy",
  terms: "/terms",
  deleteAccount: "/delete-account",
} as const;

// The in-app deletion route, rendered as numbered steps. Play reviewers follow these literally,
// so they must name the screens the SHIPPED app has. TODO(app): unconfirmed by the app side —
// BE-015 asks the app to build exactly this path (calling DELETE /users/me) or to send an APP-nnn
// with its real path, and this constant changes to match.
export const IN_APP_DELETE_PATH = ["Settings", "Account", "Delete account"] as const;

/** Shared HTML shell: self-contained (inline CSS, no scripts, fonts or external assets), light theme. */
const renderLegalPage = (title: string, lastUpdated: string, body: string): string => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; line-height: 1.6;
      color: #1f2430; background: #ffffff; margin: 0; padding: 40px 20px; }
    main { max-width: 760px; margin: 0 auto; }
    h1 { font-size: 1.9rem; line-height: 1.25; margin: 0 0 4px; }
    h2 { font-size: 1.25rem; margin: 32px 0 8px; }
    .updated { color: #6a7180; margin: 0 0 24px; }
    p, li { color: #333a46; }
    ul, ol { padding-left: 22px; }
    li { margin: 6px 0; }
    a { color: #2f6fd0; }
    strong { color: #1f2430; }
    /* Callout: pulls the deletion steps and the billing warning out of the prose. */
    .callout { background: #f3f7fd; border: 1px solid #d6e3f5; border-left: 4px solid #2f6fd0;
      border-radius: 8px; padding: 16px 20px; margin: 16px 0; }
    .callout > :first-child { margin-top: 0; }
    .callout > :last-child { margin-bottom: 0; }
    .warn { background: #fff7ed; border-color: #fed7aa; border-left-color: #ea580c; }
    .steps li { margin: 10px 0; }
    footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e3e6ec; font-size: 0.9rem; }
    footer p { color: #6a7180; margin: 4px 0; }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p class="updated">Last updated: ${lastUpdated}</p>
    ${body}
    <footer>
      <p><a href="${LEGAL_PATHS.privacy}">Privacy Policy</a> &middot;
        <a href="${LEGAL_PATHS.terms}">Terms &amp; Conditions</a> &middot;
        <a href="${LEGAL_PATHS.deleteAccount}">Delete your account</a></p>
      <p>${LEGAL_APP_NAME} is provided by ${LEGAL_COMPANY} &middot;
        <a href="mailto:${LEGAL_CONTACT_EMAIL}">${LEGAL_CONTACT_EMAIL}</a></p>
    </footer>
  </main>
</body>
</html>`;

export const renderPrivacyPolicy = (): string => {
  const app = LEGAL_APP_NAME;
  const company = LEGAL_COMPANY;
  const email = LEGAL_CONTACT_EMAIL;

  const body = `<p>This Privacy Policy explains how ${company} (&ldquo;${company}&rdquo;, &ldquo;we&rdquo;,
    &ldquo;us&rdquo;) handles information when you use the ${app} mobile app and its related services
    (the &ldquo;Service&rdquo;). ${app} is an invoice maker that works <strong>offline first</strong>:
    you can create invoices, pick templates, make PDFs and search without an account, and that data
    stays on your phone. Signing in with Google is optional and only turns on cloud features such as
    sync and backup.</p>

    <h2>1. Information We Collect</h2>
    <p><strong>If you don&rsquo;t sign in, we don&rsquo;t receive your invoices or business
    details</strong> &mdash; they stay on your device. The app still contacts our servers to download
    templates and its settings (see &ldquo;Technical information&rdquo; below).</p>
    <ul>
      <li><strong>Account information (only if you sign in).</strong> When you sign in with Google we
        receive your email address, name, a link to your profile photo, and Google&rsquo;s identifier
        for your account. We use them to create your account and keep it secure.</li>
      <li><strong>Business data you sync (only while signed in).</strong>
        <ul>
          <li>your business profile &mdash; business name, address, phone, email, GSTIN and state,
            bank name, account number and IFSC, UPI ID, and your authorised signatory&rsquo;s name
            and designation;</li>
          <li>your customers &mdash; name, phone, email, address and GSTIN;</li>
          <li>your products &mdash; name, HSN/SAC code, price, tax rate and unit;</li>
          <li>your invoices &mdash; number, dates, status, line items, amounts, notes, template and
            colour choices, and a copy of your business and customer details as they were when the
            invoice was made;</li>
          <li>your invoice settings &mdash; currency, default tax rate, numbering, default notes and
            default template.</li>
        </ul>
        PDFs are made on your device; we never receive the PDF files.</li>
      <li><strong>Images you upload.</strong> Your logo, signature and payment QR code, if you add
        them. We keep a compressed copy so they can appear on your invoices.</li>
      <li><strong>Technical information.</strong>
        <ul>
          <li>With each request the app sends its platform, version and build number, and a random
            identifier created when the app was installed. We use them only to give your copy of the
            app the right settings for its version, and we do not store them.</li>
          <li>Our web server records each request: your IP address, the date and time, the web address
            requested (which can include text you searched for), the result, and your device&rsquo;s
            &ldquo;user agent&rdquo; (a short description of the app and device making the
            request).</li>
          <li>When you sign in, we record your device&rsquo;s user agent with that sign-in
            session.</li>
        </ul></li>
    </ul>
    <p>We do not collect payment card details &mdash; ${app} does not process payments.</p>

    <h2>2. How We Use Your Information</h2>
    <ul>
      <li>To sync and back up your business data, so it is safe and available on your other
        devices.</li>
      <li>To store the images you upload and show them on your invoices.</li>
      <li>To sign you in and keep your account secure.</li>
      <li>To deliver templates and the app&rsquo;s settings for your version of the app.</li>
      <li>To run, secure and fix the Service, and to answer your support requests.</li>
      <li>To comply with the law.</li>
    </ul>
    <p>We do not sell your information, use it for advertising, or use it to profile you.</p>

    <h2>3. Your Customers&rsquo; Information</h2>
    <p>When you add your customers&rsquo; details, you decide what to add and why. You are responsible
    for having the right to share their information with us, and we use it only to provide the Service
    to you. Because an invoice is a record of a sale, each invoice keeps a copy of the customer&rsquo;s
    details as they were when it was made &mdash; deleting a customer does not change the invoices you
    already made for them.</p>

    <h2>4. How We Share Information</h2>
    <p>We do not sell or rent your information. We share it only with the providers that run the
    Service for us:</p>
    <ul>
      <li><strong>Google</strong> &mdash; Google Sign-In (only if you choose to sign in), and the email
        service behind our support inbox.</li>
      <li><strong>Amazon Web Services (AWS)</strong> &mdash; hosts our servers and database, and stores
        the images you upload.</li>
    </ul>
    <p>We may also disclose information if the law requires it, to protect the rights and safety of our
    users or ourselves, or as part of a merger or sale of our business.</p>

    <h2>5. Data Retention</h2>
    <ul>
      <li><strong>Your account and synced data</strong> are kept for as long as your account
        exists.</li>
      <li><strong>Customers and products you delete</strong> are removed from our servers straight
        away.</li>
      <li><strong>Invoices you delete</strong> are marked as deleted rather than erased, so the deletion
        also reaches your other devices. They are erased when you delete your account.</li>
      <li><strong>Sign-in sessions</strong> expire after ${SESSION_LIFETIME_DAYS} days. A record of each
        session (a one-way scrambled copy of its token, its expiry date, and your device&rsquo;s user
        agent) is kept until you delete your account.</li>
      <li><strong>Images you upload</strong>, including earlier ones you replaced, are kept until you ask
        us to remove them. They are <strong>not</strong> removed automatically when you delete your
        account &mdash; see <a href="${LEGAL_PATHS.deleteAccount}">Delete your account</a> for how to
        have them removed.</li>
      <li><strong>Web server records</strong> are kept for ${SERVER_LOG_RETENTION_DAYS} days and then
        deleted automatically. Our app server also keeps a basic record of requests (the address
        requested, the result and the timing &mdash; no IP address), which is cleared each time we
        update the Service.</li>
      <li>The app&rsquo;s platform, version and installation identifier are not stored.</li>
    </ul>

    <h2>6. Security</h2>
    <ul>
      <li>All traffic between the app and our servers is encrypted in transit (HTTPS).</li>
      <li>Our database cannot be reached from the internet &mdash; only from our own server.</li>
      <li>Sign-in tokens are stored only as one-way scrambled copies, and the tokens that access your
        data are short-lived.</li>
      <li>Every request can only reach your own account&rsquo;s data.</li>
      <li>Uploaded images are encrypted in storage. So that they can appear on your invoices, each image
        is published at a long, random web address: anyone who has that exact address can open the
        image, but we do not publish or list these addresses anywhere.</li>
    </ul>
    <p>No method of storing or sending data is completely secure, so we cannot guarantee absolute
    security.</p>

    <h2>7. Your Rights and Choices</h2>
    <p>You can use ${app} without an account. If you have one, you can:</p>
    <ul>
      <li><strong>see and correct</strong> your information in the app &mdash; your edits sync to our
        copy;</li>
      <li><strong>delete</strong> individual customers, products and invoices, or your whole account,
        from inside the app;</li>
      <li><strong>stop syncing</strong> by signing out &mdash; this stops new data reaching us, but does
        not delete what we already hold;</li>
      <li><strong>ask us</strong> for a copy of your information, to correct or erase it, or to remove
        your uploaded images.</li>
    </ul>
    <p>Depending on the law that applies to you &mdash; including India&rsquo;s Digital Personal Data
    Protection Act, 2023 &mdash; you may have further rights, such as to have a grievance addressed or to
    nominate someone to exercise your rights for you. To use any of these rights, email
    <a href="mailto:${email}">${email}</a>. We respond within ${REQUEST_RESPONSE_DAYS} days.</p>

    <h2>8. Children</h2>
    <p>${app} is a business tool and is not intended for anyone under ${MIN_AGE_YEARS}. We do not
    knowingly collect information from children. If you believe a child has given us information,
    contact us and we will delete it.</p>

    <h2>9. Where Your Data Is Stored</h2>
    <p>We store your information in India, in Amazon Web Services&rsquo; Mumbai region. Google handles
    sign-in and our support email under its own policies, which may involve processing outside
    India.</p>

    <h2>10. Changes to This Policy</h2>
    <p>We may update this policy. When we do, we will change the &ldquo;Last updated&rdquo; date above
    and, where appropriate, tell you in the app. Continuing to use the Service after an update means you
    accept it.</p>

    <h2>11. Contact Us</h2>
    <p>${app} is provided by ${company}. For questions about this policy or your information, email
    <a href="mailto:${email}">${email}</a>.</p>`;

  return renderLegalPage(`${app} Privacy Policy`, PRIVACY_EFFECTIVE_DATE, body);
};

export const renderTermsAndConditions = (): string => {
  const app = LEGAL_APP_NAME;
  const company = LEGAL_COMPANY;
  const email = LEGAL_CONTACT_EMAIL;

  const body = `<p>These Terms &amp; Conditions (&ldquo;Terms&rdquo;) are an agreement between you and
    ${company} (&ldquo;${company}&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) for your use of the ${app}
    mobile app and its related services (the &ldquo;Service&rdquo;). By downloading or using the
    Service you agree to these Terms. If you do not agree, do not use the Service.</p>

    <h2>1. Acceptance and Eligibility</h2>
    <p>You must be at least ${MIN_AGE_YEARS} years old and able to enter into a binding contract to use
    the Service. If you use it on behalf of a business, you confirm that you are authorised to accept
    these Terms for that business.</p>

    <h2>2. The Service</h2>
    <p>${app} lets you create, customise and share invoices. Its core features &mdash; creating
    invoices, choosing templates, making PDFs and searching &mdash; work on your device without an
    account. Signing in with Google is optional and adds cloud features: sync and backup of your
    business data across devices, and storage for your logo, signature and payment QR image. Features
    and templates may change over time.</p>

    <h2>3. Your Account</h2>
    <p>You sign in with your Google account. You are responsible for keeping it secure and for activity
    under your ${app} account; tell us promptly at <a href="mailto:${email}">${email}</a> if you
    suspect unauthorised use. You can delete your account at any time &mdash; see
    <a href="${LEGAL_PATHS.deleteAccount}">Delete your account</a>.</p>

    <h2>4. Licence to Use the App</h2>
    <p>Subject to these Terms, we grant you a limited, personal, non-exclusive, non-transferable,
    revocable licence to use the Service, including its invoice templates to make your own invoices. You
    may not resell, sublicense, copy or redistribute the app or its templates except as these Terms
    allow.</p>

    <h2>5. Premium Templates and Payments</h2>
    <ul>
      <li>Some templates are marked <strong>Premium</strong> and can be used only by accounts that have
        premium access.</li>
      <li>${app} does not currently sell anything in the app. If we introduce paid features, they will
        be sold through Google Play and subject to its terms, the price will be shown before you buy,
        refunds will follow Google Play&rsquo;s refund policies, and we will update these Terms before
        charging for anything.</li>
      <li>${app} does not process payments between you and your customers. Payment details you put on
        an invoice &mdash; such as a UPI ID, bank account or QR code &mdash; are information you
        provide for your customer&rsquo;s convenience. Payments are made outside the app, and we are
        not a party to them.</li>
    </ul>

    <h2>6. Your Content and Rights</h2>
    <p>You own the invoices, customer records, business details and images you create or upload
    (&ldquo;Your Content&rdquo;). You grant us a limited licence to store, copy, process and display
    Your Content only to provide the Service to you &mdash; for example, to sync it and to show your
    images on your invoices. <strong>You confirm that you have all rights and permissions
    necessary</strong> for Your Content: that you may use any logo you upload, that a signature you
    upload is yours or is used with its owner&rsquo;s consent, and that you may share your
    customers&rsquo; details with us.</p>

    <h2>7. Acceptable Use</h2>
    <p>You agree not to use the Service to:</p>
    <ul>
      <li>create false, fraudulent or misleading invoices, or invoices for goods or services that were
        not supplied;</li>
      <li>impersonate another business, or use another business&rsquo;s name, logo, GSTIN, signature
        or bank details without its permission;</li>
      <li>upload content that is unlawful or infringes anyone&rsquo;s rights;</li>
      <li>reverse engineer, scrape, overload or disrupt the Service, or get around its limits or
        premium restrictions; or</li>
      <li>break any applicable law, including tax law.</li>
    </ul>
    <p>We may suspend accounts that break these Terms.</p>

    <h2>8. Invoices, Calculations, and Tax</h2>
    <p>The app calculates totals and taxes from the amounts, quantities and rates you enter. We take
    care to calculate correctly, but you are responsible for checking every invoice before you issue it
    and for its accuracy. ${app} is a document tool, not tax, legal or accounting advice: you are
    responsible for making sure your invoices meet the rules that apply to you, including GST
    requirements, rates and invoice formats.</p>

    <h2>9. Intellectual Property</h2>
    <p>The Service &mdash; including the app, its software, its templates and designs, and our branding
    &mdash; belongs to ${company} or its licensors and is protected by law. These Terms give you no
    rights in it except the licence in section 4. The invoices you create with it are yours.</p>

    <h2>10. Third-Party Services</h2>
    <p>The Service relies on third parties, including Google (sign-in, and app distribution through
    Google Play) and Amazon Web Services (hosting and storage). Your use of their services is subject to
    their terms, and we are not responsible for them &mdash; nor for the payment apps or banks your
    customers use to pay you.</p>

    <h2>11. Availability</h2>
    <p>Because ${app} works offline, creating invoices and PDFs does not depend on our servers. Cloud
    features do, and may sometimes be unavailable, slow, or changed. Keep your own copies of the
    invoices you need for your records.</p>

    <h2>12. Termination</h2>
    <p>You may stop using the Service and delete your account at any time. We may suspend or end your
    access if you break these Terms, or where needed to protect the Service or its users. Terms that by
    their nature should survive termination continue to apply.</p>

    <h2>13. Disclaimers</h2>
    <p>The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of
    any kind, whether express or implied, including merchantability, fitness for a particular purpose
    and non-infringement, to the fullest extent permitted by law.</p>

    <h2>14. Limitation of Liability</h2>
    <p>To the maximum extent permitted by law, ${company} will not be liable for any indirect,
    incidental, special, consequential or punitive damages, or for any loss of data, profits, revenue
    or goodwill, including losses caused by figures, tax treatment or invoices you did not check. Our
    total liability for any claim relating to the Service is limited to the amount you paid us for it in
    the 12 months before the claim.</p>

    <h2>15. Indemnification</h2>
    <p>You agree to indemnify and hold ${company} harmless from claims, losses and expenses arising from
    Your Content, the invoices you issue, your use of the Service, or your breach of these Terms or of
    any law or third-party right.</p>

    <h2>16. Governing Law</h2>
    <p>These Terms are governed by the laws of ${TERMS_GOVERNING_LAW}. You agree to the exclusive
    jurisdiction of the courts of ${TERMS_GOVERNING_LAW}, except where the law that applies to you
    provides otherwise.</p>

    <h2>17. Changes to These Terms</h2>
    <p>We may update these Terms. When we do, we will change the &ldquo;Last updated&rdquo; date above
    and, where appropriate, tell you in the app. Continuing to use the Service after an update means you
    accept it.</p>

    <h2>18. Contact Us</h2>
    <p>${app} is provided by ${company}. Questions about these Terms? Email
    <a href="mailto:${email}">${email}</a>.</p>`;

  return renderLegalPage(`${app} Terms &amp; Conditions`, TERMS_EFFECTIVE_DATE, body);
};

// "Go to Settings." → "Open Account." → "Tap Delete account and confirm." — from IN_APP_DELETE_PATH.
const inAppDeleteSteps = (): string =>
  IN_APP_DELETE_PATH.map((screen, i) => {
    const last = i === IN_APP_DELETE_PATH.length - 1;
    const verb = i === 0 ? "Go to" : last ? "Tap" : "Open";
    return `<li>${verb} <strong>${screen}</strong>${last ? ", then confirm" : ""}.</li>`;
  }).join("\n        ");

/**
 * Account-deletion page — the "Delete account URL" on the Google Play listing.
 *
 * Play requires it to (1) name the app and developer as they appear on the listing, (2) put the
 * steps to request deletion front and centre — including a route for someone who no longer has the
 * app — and (3) say what is deleted, what is kept, and for how long.
 *
 * What is deleted = what DELETE /users/me (userService.deleteAccount) removes: the User row, which
 * cascades to Company, Customer, Product, Invoice (+ InvoiceItem, tombstones included), Settings and
 * RefreshToken. What is kept = what genuinely survives that call: the S3 images under
 * media/<userId>/ (nothing deletes them — disclosed by the owner's decision, 2026-09-24), and the
 * nginx logs. The email route can remove images too because the operator can still map the account
 * to its media/<userId>/ prefix BEFORE deleting the row; after an in-app deletion that link is gone.
 */
export const renderDeleteAccount = (): string => {
  const app = LEGAL_APP_NAME;
  const company = LEGAL_COMPANY;
  const email = LEGAL_CONTACT_EMAIL;
  const deleteSubject = encodeURIComponent(`Delete my ${app} account`);

  const body = `<p>This page explains how to delete your <strong>${app}</strong> account and the data
    associated with it. ${app} is published by <strong>${company}</strong>, the developer named on our
    Google Play listing.</p>

    <p>${app} works without an account. <strong>If you never signed in, we hold no invoices or business
    data of yours</strong> &mdash; it is all on your phone, and uninstalling ${app} or clearing its
    storage removes it.</p>

    <p>If you did sign in, there are two ways to delete your account: inside the app, or by email if you
    no longer have the app.</p>

    <h2>Option 1 &mdash; Delete your account in the app</h2>
    <div class="callout">
      <ol class="steps">
        <li>Open <strong>${app}</strong> and make sure you are signed in to the account you want to
          delete.</li>
        ${inAppDeleteSteps()}
      </ol>
    </div>
    <p>Your account and its data are deleted from our servers <strong>immediately and
    permanently</strong>, and you are signed out. This cannot be undone, and we cannot restore a deleted
    account. It does not remove the images you uploaded &mdash; if you want those removed too, email us
    <strong>before</strong> you delete your account, or use Option 2 instead (see &ldquo;What is kept,
    and for how long&rdquo;).</p>

    <h2>Option 2 &mdash; Request deletion by email</h2>
    <p>Use this if you have uninstalled the app or cannot sign in. It removes your uploaded images as
    well.</p>
    <div class="callout">
      <ol class="steps">
        <li>Email <a href="mailto:${email}?subject=${deleteSubject}">${email}</a> from the Google account
          email address you signed in to ${app} with.</li>
        <li>Use the subject line <strong>Delete my ${app} account</strong>.</li>
        <li>Reply to our confirmation message if we send one &mdash; we may need to check that the
          account is yours, so that nobody else can delete it.</li>
      </ol>
    </div>
    <p>We complete verified requests within <strong>${REQUEST_RESPONSE_DAYS} days</strong>, and email you
    once it is done.</p>

    <h2>What is deleted</h2>
    <p>Deleting your account permanently removes from our servers:</p>
    <ul>
      <li><strong>Your account details</strong> &mdash; email address, name, profile photo link, and the
        Google account identifier linked to your ${app} account.</li>
      <li><strong>Your business profile</strong> &mdash; including your address, GSTIN, bank and UPI
        details, and your authorised signatory&rsquo;s name and designation.</li>
      <li><strong>All your invoices</strong>, including ones you had already deleted, with their line
        items.</li>
      <li><strong>Your customers and products.</strong></li>
      <li><strong>Your invoice settings.</strong></li>
      <li><strong>Your sign-in sessions</strong>, on every device.</li>
    </ul>

    <h2>What is kept, and for how long</h2>
    <ul>
      <li><strong>Images you uploaded</strong> &mdash; your logo, signature and payment QR image,
        including earlier ones you replaced. These are <strong>not removed automatically</strong> when
        you delete your account in the app. They stay at long, random web addresses that we do not
        publish or list anywhere, until you ask us to remove them. Deleting by email (Option 2) removes
        them; if you delete in the app, email us <strong>before</strong> you do &mdash; once the account
        is gone we can no longer tell which images were yours.</li>
      <li><strong>Web server records</strong> (up to <strong>${SERVER_LOG_RETENTION_DAYS}
        days</strong>) &mdash; technical records of requests, such as IP addresses, that we use to run
        and secure the Service. They are deleted automatically.</li>
    </ul>
    <p>Some things are outside our control: invoices and data stored on your phone stay there until you
    uninstall ${app} or clear its storage, and invoices you already sent to your customers are theirs
    to keep.</p>

    <h2>If you ever buy a subscription</h2>
    <div class="callout warn">
      <p>${app} does not sell subscriptions today. If you ever buy one through Google Play, deleting your
      ${app} account will <strong>not</strong> cancel it, and <strong>Google Play will keep charging
      you</strong> until you cancel it there: open the <strong>Google Play Store</strong> app &rarr; tap
      your profile icon &rarr; <strong>Payments &amp; subscriptions</strong> &rarr;
      <strong>Subscriptions</strong> &rarr; select <strong>${app}</strong> &rarr; <strong>Cancel
      subscription</strong>.</p>
    </div>

    <h2>Questions</h2>
    <p>For questions about deleting your account or your data, email
    <a href="mailto:${email}">${email}</a>. You can also read our
    <a href="${LEGAL_PATHS.privacy}">Privacy Policy</a> and
    <a href="${LEGAL_PATHS.terms}">Terms &amp; Conditions</a>.</p>`;

  return renderLegalPage(`Delete your ${app} account`, DELETE_ACCOUNT_EFFECTIVE_DATE, body);
};
