import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePlanTaskPaths } from '../../src/engine/plan-task-parse.js';

const fixturePlanPath = fileURLToPath(
  new URL('../fixtures/daemon-e2e/plan.md', import.meta.url),
);

describe('daemon E2E fixture', () => {
  it('parses only the real task headings without a dependency-graph phantom', async () => {
    const plan = await readFile(fixturePlanPath, 'utf-8');

    expect([...parsePlanTaskPaths(plan).keys()].sort()).toEqual(['1', 'T0']);
  });

  it('excludes inline prose backticks from Task 1 corroboration paths', async () => {
    const plan = await readFile(fixturePlanPath, 'utf-8');

    expect([...parsePlanTaskPaths(plan).get('1')!]).toEqual([
      'test/fixtures/daemon-e2e/touched.txt',
    ]);
  });
});
