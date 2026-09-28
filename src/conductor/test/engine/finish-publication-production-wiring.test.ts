import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const engineTestDir = dirname(fileURLToPath(import.meta.url));
const sourceRoot = join(engineTestDir, '..', '..', 'src');

describe('production FINISH coordinator wiring', () => {
  it('constructs the coordinator at both foreground and daemon composition roots', async () => {
    const [foreground, daemon] = await Promise.all([
      readFile(join(sourceRoot, 'index.ts'), 'utf8'),
      readFile(join(sourceRoot, 'daemon-cli.ts'), 'utf8'),
    ]);

    for (const source of [foreground, daemon]) {
      expect(source).toContain('createProductionFinishPublicationCoordinator');
      expect(source).toContain('createProvenanceGuardedFinishPresentationRepair');
      expect(source).toMatch(/new Conductor\(\{[\s\S]*?finishPublication:\s*createProductionFinishPublicationCoordinator\(/);
      expect(source).toMatch(
        /repairPresentation:\s*createProvenanceGuardedFinishPresentationRepair\(\{[\s\S]*?git:\s*finishPublicationGit,[\s\S]*?gh:\s*finishPublicationGh/,
      );
    }

    expect(foreground).toMatch(
      /const finishPublicationBaseBranch\s*=\s*\(await originDefaultBranch\(makeGitRunner\(projectRoot\)\)\) \?\? 'main';/,
    );
    expect(foreground).toMatch(
      /finishPublication:\s*createProductionFinishPublicationCoordinator\(\{[\s\S]*?baseBranch:\s*finishPublicationBaseBranch/,
    );
    expect(daemon).toMatch(
      /finishPublication:\s*createProductionFinishPublicationCoordinator\(\{[\s\S]*?baseBranch,/
    );

    for (const source of [foreground, daemon]) {
      expect(source).toMatch(
        /finishPublication:\s*createProductionFinishPublicationCoordinator\(\{[\s\S]*?prTemplateBytes:\s*config\?\.pr_template_bytes/,
      );
    }
  });

  it('routes both production ready paths through the capture-verifying repair before ready', async () => {
    const [foreground, daemon, conductor] = await Promise.all([
      readFile(join(sourceRoot, 'index.ts'), 'utf8'),
      readFile(join(sourceRoot, 'daemon-cli.ts'), 'utf8'),
      readFile(join(sourceRoot, 'engine', 'conductor.ts'), 'utf8'),
    ]);

    for (const source of [foreground, daemon]) {
      expect(source).toContain('repairPresentation: createProvenanceGuardedFinishPresentationRepair');
    }

    const repairStart = conductor.indexOf('export function createFinishPresentationRepair');
    const restore = conductor.indexOf('const captures = await readRegionCaptures', repairStart);
    const verify = conductor.indexOf('region verification mismatch for ${key}', restore);
    const ready = conductor.indexOf('const outcome = await ensureShipReady', verify);
    expect(repairStart).toBeGreaterThanOrEqual(0);
    expect(restore).toBeGreaterThan(repairStart);
    expect(verify).toBeGreaterThan(restore);
    expect(ready).toBeGreaterThan(verify);
  });
});
