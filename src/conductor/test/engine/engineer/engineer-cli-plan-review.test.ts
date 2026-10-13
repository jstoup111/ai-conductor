// Covers: task:15
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('compose plan-review command surface', () => {
  it('registers the subcommand in the engineer CLI and top-level CLI without importing conductor machinery', async () => {
    const engineer = await readFile(new URL('../../../src/engine/engineer-cli.ts', import.meta.url), 'utf8');
    expect(engineer).toContain("'plan-review'");
    expect(engineer).toContain('new EventPersister');
    expect(engineer).toContain('runPlanReview({');
    expect(engineer).not.toContain("from './conductor.js'");
  });
});
