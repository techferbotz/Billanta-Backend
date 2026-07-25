/**
 * Seed the starter templates: create each, compile it to a Draft version, and publish v1.
 * Idempotent — a template that already has a published version is skipped.
 *
 * Requires a reachable Postgres (DATABASE_URL). Run AFTER migrating:
 *   npm run prisma:migrate:deploy
 *   npm run seed:templates
 */
import { prisma } from "../prisma/client";
import { templateRepository } from "../modules/template/repository/template.repository";
import { compileTemplate } from "../templates/compile/compiler";
import { SEED_TEMPLATES } from "../templates/seed/seedTemplates";

const main = async (): Promise<void> => {
  for (const seed of SEED_TEMPLATES) {
    const existing = await templateRepository.findById(seed.id);
    if (existing && existing.currentVersionId) {
      console.log(`  skip   ${seed.id} (already published)`);
      continue;
    }

    if (!existing) {
      await templateRepository.createTemplate({
        id: seed.id,
        name: seed.name,
        description: seed.description,
        category: seed.category,
        isPremium: seed.isPremium,
      });
    }

    // Compile (throws with an exact location if a seed is ever broken — caught by CI's
    // checkSeedTemplates before it ever reaches here).
    const result = compileTemplate(seed.html, seed.css);
    const version = await templateRepository.createVersion({
      templateId: seed.id,
      sourceHtml: seed.html,
      sourceCss: seed.css,
      compiled: result.compiled,
      compilerVersion: result.compilerVersion,
      checksum: result.checksum,
    });
    await templateRepository.publishVersion(seed.id, version.id);
    console.log(`  seed   ${seed.id} -> published v${version.version} (${seed.isPremium ? "premium" : "free"})`);
  }

  await prisma.$disconnect();
  console.log("\nDone.");
};

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
