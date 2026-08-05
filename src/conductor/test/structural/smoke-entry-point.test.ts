import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const structuralRoot = dirname(fileURLToPath(import.meta.url));
const conductorRoot = join(structuralRoot, '../..');

describe('structural: smoke test entry point', () => {
  it('selects only smoke tests without inheriting the default smoke exclusions', async () => {
    const config = await readFile(join(conductorRoot, 'vitest.smoke.config.ts'), 'utf8');

    expect(config).toContain("include: ['test/smoke/**', '**/*.smoke.test.ts']");
    expect(config).toContain('exclude: []');
  });
});
