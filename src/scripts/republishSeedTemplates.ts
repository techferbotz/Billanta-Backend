/**
 * Re-publish the seed templates when their compiled tree has CHANGED.
 *
 * Unlike `seedTemplates.ts` (which skips any template that already has a published version), this
 * compiles each seed and — if the freshly-compiled checksum differs from the current published
 * version — publishes a NEW immutable version and makes it current. Needed after a compiler or seed
 * change (e.g. APP-003 theme tokens + sections): published `(templateId, version)` trees are
 * immutable, so new capability only reaches clients via a new version.
 *
 * Idempotent: re-running when nothing changed is a no-op (checksums match → skip). Only touches the
 * three seed templates (classic/minimal/bold); user-authored templates are never affected.
 *
 * Run on the box AFTER migrating + deploying the app:
 *   docker compose -f docker-compose.prod.yml run --rm --build migrate \
 *     npx ts-node src/scripts/republishSeedTemplates.ts
 */
import { prisma } from "../prisma/client";
import { templateRepository } from "../modules/template/repository/template.repository";
import { compileTemplate } from "../templates/compile/compiler";
import { SEED_TEMPLATES } from "../templates/seed/seedTemplates";

const main = async (): Promise<void> => {
  for (const seed of SEED_TEMPLATES) {
    const result = compileTemplate(seed.html, seed.css);
    const existing = await templateRepository.findById(seed.id);

    // A template that doesn't exist yet (fresh DB) is created, then published below like the seeder.
    if (!existing) {
      await templateRepository.createTemplate({
        id: seed.id,
        name: seed.name,
        description: seed.description,
        category: seed.category,
        isPremium: seed.isPremium,
      });
    }

    // If the current published version already carries this exact tree, nothing to do.
    const current = existing?.currentVersionId
      ? await templateRepository.findVersionById(existing.currentVersionId)
      : null;
    if (current && current.checksum === result.checksum) {
      console.log(`  skip       ${seed.id.padEnd(9)} up to date (checksum ${result.checksum.slice(0, 12)}…)`);
      continue;
    }

    const version = await templateRepository.createVersion({
      templateId: seed.id,
      sourceHtml: seed.html,
      sourceCss: seed.css,
      compiled: result.compiled,
      compilerVersion: result.compilerVersion,
      checksum: result.checksum,
    });
    await templateRepository.publishVersion(seed.id, version.id);
    console.log(
      `  ${current ? "republish" : "publish  "} ${seed.id.padEnd(9)} -> v${version.version} (checksum ${result.checksum.slice(0, 12)}…)`
    );
  }

  await prisma.$disconnect();
  console.log("\nDone.");
};

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
