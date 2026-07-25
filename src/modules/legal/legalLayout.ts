// Shared layout for the public legal pages. One self-contained HTML document (inline CSS, no
// external assets), so Google Play's crawler and the app's in-app links render it anywhere.
//
// These are TEMPLATES: the product name, contact email and effective date below are sensible
// defaults, but the pages must be reviewed by a lawyer and the placeholders confirmed before
// launch. See docs/DEPLOY.md.
export const LEGAL = {
  product: "Billanta",
  company: "Billanta",
  contactEmail: "vishalb250601@gmail.com",
  effectiveDate: "25 July 2026",
};

export const legalPage = (title: string, bodyHtml: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — ${LEGAL.product}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f6f7f9; color: #1f2430; font: 16px/1.65 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 40px 20px 80px; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  h2 { font-size: 19px; margin: 32px 0 8px; }
  .meta { color: #6a7180; font-size: 14px; margin-bottom: 8px; }
  p, li { color: #333a46; }
  ul { padding-left: 22px; }
  a { color: #2f6fd0; }
  code { background: #eceef2; padding: 1px 5px; border-radius: 4px; font-size: 14px; }
  .note { background: #fff7e6; border: 1px solid #f0d9a8; border-radius: 8px; padding: 12px 14px; font-size: 14px; color: #7a5a12; margin: 20px 0; }
  footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e3e6ec; color: #6a7180; font-size: 14px; }
  @media (prefers-color-scheme: dark) {
    body { background: #14171f; color: #e6e9ef; }
    p, li { color: #c7ccd6; }
    code { background: #2c3341; }
    .note { background: #2a2413; border-color: #4a3e1a; color: #d8c48a; }
    footer { border-color: #2c3341; }
  }
</style>
</head>
<body>
<main>
${bodyHtml}
<footer>
  <p>${LEGAL.company} · Contact: <a href="mailto:${LEGAL.contactEmail}">${LEGAL.contactEmail}</a></p>
</footer>
</main>
</body>
</html>`;
