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
      expect(source).toMatch(/new Conductor\(\{[\s\S]*?finishPublication:\s*createProductionFinishPublicationCoordinator\(/);
    }
  });
});
