/**
 * Fixture checks for the public legal pages (HOA protocol 12). No DB, no server, no network.
 * Run: npx ts-node src/scripts/checkLegal.ts   (or npm run check:legal)
 *
 * Keeps three things from drifting apart: the pages and the constants they quote (retention
 * windows, dates, contact), the pages and Google Play's requirements for them, and the pages and
 * the links GET /config hands the app. A failure here is a store-listing problem, not a nitpick.
 * Exits 1 on the first failed assertion.
 */

// config/env.ts fails fast on missing REQUIRED vars; this script needs none of them, so
// placeholders satisfy the check when there is no .env. Only MISSING variables are set.
for (const key of ["DATABASE_URL", "JWT_SECRET", "GOOGLE_CLIENT_ID", "ADMIN_API_KEY"]) {
  process.env[key] ??= "check-placeholder";
}

import assert from "node:assert/strict";
import { config } from "../config/env";
import legalRoutes from "../modules/legal/legal.routes";
import {
  DELETE_ACCOUNT_EFFECTIVE_DATE,
  LEGAL_APP_NAME,
  LEGAL_COMPANY,
  LEGAL_CONTACT_EMAIL,
  LEGAL_PATHS,
  MIN_AGE_YEARS,
  PRIVACY_EFFECTIVE_DATE,
  REQUEST_RESPONSE_DAYS,
  SERVER_LOG_RETENTION_DAYS,
  SESSION_LIFETIME_DAYS,
  TERMS_EFFECTIVE_DATE,
  TERMS_GOVERNING_LAW,
  renderDeleteAccount,
  renderPrivacyPolicy,
  renderTermsAndConditions,
} from "../modules/legal/legal.view";
import { DEFAULT_REMOTE_CONFIG } from "../modules/remoteConfig/remoteConfig.defaults";

let passed = 0;
const check = (name: string, fn: () => void): void => {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exit(1);
  }
};

// Prose wraps across source lines, so match against collapsed whitespace rather than pinning
// assertions to the template literal's line breaks.
const text = (html: string): string => html.replace(/\s+/g, " ");
const includesAll = (html: string, needles: readonly string[], what: string): void => {
  for (const needle of needles) {
    assert.ok(text(html).includes(needle), `${what}: missing "${needle}"`);
  }
};

const pages = {
  privacy: renderPrivacyPolicy(),
  terms: renderTermsAndConditions(),
  deleteAccount: renderDeleteAccount(),
};

console.log("\nevery page");

check("is a full, self-contained, light-theme HTML document", () => {
  for (const [name, html] of Object.entries(pages)) {
    assert.ok(html.startsWith("<!DOCTYPE html>"), `${name}: not a full HTML document`);
    assert.match(html, /<html lang="en">/, `${name}: no lang`);
    assert.match(html, /<title>[^<]+<\/title>/, `${name}: no title`);
    assert.match(html, /<meta name="viewport"/, `${name}: not mobile-ready`);
    assert.match(html, /color-scheme: light;/, `${name}: must be light theme`);
    // Self-contained: no scripts, stylesheets, embeds or absolute URLs of any kind — every link
    // is a relative path on this origin or a mailto:.
    assert.doesNotMatch(html, /<script|<link|<iframe|<img|\bsrc=/i, `${name}: external asset`);
    assert.doesNotMatch(html, /https?:\/\//, `${name}: absolute URL`);
    for (const [, href] of html.matchAll(/href="([^"]*)"/g)) {
      assert.ok(href.startsWith("/") || href.startsWith("mailto:"), `${name}: odd href ${href}`);
    }
  }
});

check("names the app and developer, and links the contact address", () => {
  for (const [name, html] of Object.entries(pages)) {
    assert.ok(html.includes(LEGAL_APP_NAME), `${name}: no app name`);
    assert.ok(html.includes(LEGAL_COMPANY), `${name}: no developer name`);
    assert.ok(html.includes(`mailto:${LEGAL_CONTACT_EMAIL}`), `${name}: no contact link`);
  }
});

check("no unfilled placeholder or developer-facing template banner is published", () => {
  for (const [name, html] of Object.entries(pages)) {
    assert.doesNotMatch(html, /TODO|\[your |placeholder|starting template/i, `${name}: placeholder`);
  }
});

console.log("\nprivacy policy");

check("covers every section protocol 12 requires", () => {
  includesAll(
    pages.privacy,
    [
      "Information We Collect", // what is collected
      "How We Use Your Information", // how it is used
      "How We Share Information", // processors by name
      "Data Retention", // retention
      "Security",
      "Your Rights and Choices", // rights + how to exercise them
      "Children",
      "Where Your Data Is Stored", // international transfers
      "Changes to This Policy",
      "Contact Us",
    ],
    "privacy"
  );
  assert.ok(pages.privacy.includes(`Last updated: ${PRIVACY_EFFECTIVE_DATE}`));
});

check("names the processors the code actually uses, and where data lives", () => {
  includesAll(pages.privacy, ["Google Sign-In", "Amazon Web Services", "Mumbai"], "privacy");
});

check("quotes the retention constants and the minimum age", () => {
  includesAll(
    pages.privacy,
    [
      `expire after ${SESSION_LIFETIME_DAYS} days`,
      `kept for ${SERVER_LOG_RETENTION_DAYS} days`,
      `within ${REQUEST_RESPONSE_DAYS} days`,
      `under ${MIN_AGE_YEARS}`,
    ],
    "privacy"
  );
});

check("discloses what the code really does with images, deletes and technical headers", () => {
  // Pinned on purpose: account deletion is email-only while the app's in-app row is hidden
  // (APP-013), and the email runbook removes images. When the in-app row ships, DELETE /users/me
  // becomes a user-facing route that keeps images — this check and the pages must change together.
  includesAll(
    pages.privacy,
    [
      "kept until you delete your account or ask us to remove them",
      "your whole account by emailing us",
      "anyone who has that exact address can open the image",
      "Invoices you delete</strong> are marked as deleted rather than erased",
      "random identifier created when the app was installed",
      "we do not store them",
    ],
    "privacy"
  );
});

console.log("\nterms & conditions");

check("covers every section protocol 12 requires", () => {
  includesAll(
    pages.terms,
    [
      "Acceptance and Eligibility",
      "The Service",
      "Your Account",
      "Licence to Use the App",
      "Premium Templates and Payments", // paid features / store billing / refunds
      "Your Content and Rights", // user content + consent
      "Acceptable Use",
      "Invoices, Calculations, and Tax", // Billanta's caveat (no AI)
      "Intellectual Property",
      "Third-Party Services",
      "Termination",
      "Disclaimers",
      "Limitation of Liability",
      "Indemnification",
      "Governing Law",
      "Changes to These Terms",
      "Contact Us",
    ],
    "terms"
  );
  assert.ok(pages.terms.includes(`Last updated: ${TERMS_EFFECTIVE_DATE}`));
});

check("states eligibility, consent, refunds, the liability cap and the governing law", () => {
  includesAll(
    pages.terms,
    [
      `at least ${MIN_AGE_YEARS} years old`,
      "rights and permissions necessary",
      "consent",
      "refunds will follow Google Play",
      "the 12 months before the claim",
      `governed by the laws of ${TERMS_GOVERNING_LAW}`,
    ],
    "terms"
  );
});

console.log("\ndelete-account page (Google Play's three requirements)");

check("names the app and the developer on the store listing", () => {
  includesAll(
    pages.deleteAccount,
    [`Delete your ${LEGAL_APP_NAME} account`, `published by <strong>${LEGAL_COMPANY}</strong>`],
    "delete-account"
  );
  assert.ok(pages.deleteAccount.includes(`Last updated: ${DELETE_ACCOUNT_EFFECTIVE_DATE}`));
});

check("gives the email route as numbered steps, and no in-app steps (APP-013)", () => {
  const html = pages.deleteAccount;
  assert.ok(html.includes('<ol class="steps">'));
  // The app hides its in-app deletion row; reviewers follow this page literally, so it must not
  // name an in-app screen until a later APP entry says the row has shipped.
  assert.doesNotMatch(html, /\bSettings\b|\bProfile\b|Option 1|in the app/, "names an in-app path");
  includesAll(
    html,
    [
      `mailto:${LEGAL_CONTACT_EMAIL}?subject=`,
      `Delete my ${LEGAL_APP_NAME} account`,
      `within <strong>${REQUEST_RESPONSE_DAYS} days</strong>`,
    ],
    "delete-account"
  );
});

check("lists what is deleted — every table DELETE /users/me cascades to", () => {
  includesAll(
    pages.deleteAccount,
    [
      "What is deleted",
      "Your account details",
      "Your business profile",
      "The images you uploaded",
      "All your invoices</strong>, including ones you had already deleted",
      "Your customers and products",
      "Your invoice settings",
      "Your sign-in sessions",
    ],
    "delete-account"
  );
});

check("states what is kept, and for how long", () => {
  includesAll(
    pages.deleteAccount,
    [
      "What is kept, and for how long",
      `up to <strong>${SERVER_LOG_RETENTION_DAYS} days</strong>`,
    ],
    "delete-account"
  );
  // The email runbook deletes the images, so they must not be listed as kept.
  assert.doesNotMatch(text(pages.deleteAccount), /not removed automatically/);
});

check("warns that deleting the account does not cancel a Play subscription", () => {
  includesAll(pages.deleteAccount, ["Cancel subscription", "keep charging you"], "delete-account");
});

console.log("\nroutes + GET /config");

check("the canonical paths and their aliases are all served", () => {
  const served = new Set<string>();
  for (const layer of (legalRoutes as unknown as { stack: { route?: { path: string | string[] } }[] })
    .stack) {
    const path = layer.route?.path;
    for (const p of Array.isArray(path) ? path : path ? [path] : []) served.add(p);
  }
  for (const p of [
    LEGAL_PATHS.privacy,
    "/privacy-policy",
    LEGAL_PATHS.terms,
    "/terms-of-service",
    LEGAL_PATHS.deleteAccount,
    "/account-deletion",
  ]) {
    assert.ok(served.has(p), `route ${p} is not served`);
  }
});

check("GET /config links point at exactly these pages, on the public origin", () => {
  assert.match(config.publicUrl, /^https?:\/\/[^/]+$/, "publicUrl must be a bare origin");
  assert.deepEqual(DEFAULT_REMOTE_CONFIG.links, {
    privacyPolicy: `${config.publicUrl}${LEGAL_PATHS.privacy}`,
    terms: `${config.publicUrl}${LEGAL_PATHS.terms}`,
    deleteAccount: `${config.publicUrl}${LEGAL_PATHS.deleteAccount}`,
    supportEmail: LEGAL_CONTACT_EMAIL,
  });
});

console.log(`\n${passed} passed, 0 failed\n`);
