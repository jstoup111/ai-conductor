import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const engineRoot = join(dirname(fileURLToPath(import.meta.url)), '../../src/engine');

describe('slice-topology consumer boundary', () => {
  it('keeps sealed-plan topology behind its explicit production readers', async () => {
    const paths = (await readdir(engineRoot, { recursive: true })).filter((path) => path.endsWith('.ts'));
    const importers = (await Promise.all(paths.map(async (path) => ({
      path,
      source: await readFile(join(engineRoot, path), 'utf8'),
    })))).filter(({ source }) => /from\s*['"][^'"]*slice-topology\.js['"]/.test(source))
      .map(({ path }) => path)
      .sort();

    expect(importers).toEqual([
      'artifacts.ts', 'child-cursor.ts', 'child-lifecycle.ts', 'conductor.ts',
      'daemon-dashboard.ts', 'daemon-observe-cli.ts', 'finish-publication-production.ts',
      'reseal-cli.ts', 'routing/owner-derivation.ts', 'routing/round-router.ts',
      'step-runners.ts', 'task-cli.ts', 'task-membership-check-cli.ts', 'task-progress.ts',
    ]);
  });
});
