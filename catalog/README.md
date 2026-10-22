# Template catalog

The source of the templates published on production, one folder per template slug:
`template.html`, `template.css` and `meta.json` (name, description, category, premium). A published
version is immutable and its source otherwise lives only in the database, so this folder is what lets
a template be re-published, reviewed or rebuilt (for example after the server-driven-fields wipe).

| Slug | Look |
| --- | --- |
| `amber` | Minimal, full-bleed yellow accent band, boxed item table, filled total bar |
| `amethyst` | Purple tax invoice with a hideable tax column, bank details and a signatory block |
| `cobalt` | Ruled corporate frame, navy item table, Bill To / Ship To, filled totals panel |

The seed templates in `src/templates/seed/seedTemplates.ts` (classic, minimal, bold) are the authoring
examples and the compiler's test corpus; they aren't published.

**Change a template** by editing its files here, then:

```bash
npx ts-node src/scripts/verifyTemplate.ts catalog/<slug>/template.html catalog/<slug>/template.css
npm run thumbnail:render -- --html catalog/<slug>/template.html --css catalog/<slug>/template.css --out preview.png
```

and publish it as a new version with `src/scripts/publishTemplate.ts` (the `new-invoice-template`
skill's Step 6 shows the exact command). Commit the change here in the same go.
