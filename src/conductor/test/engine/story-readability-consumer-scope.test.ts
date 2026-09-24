import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  checkStepCompletion,
  extractAuthoritativeStoryCriteria,
} from '../../src/engine/artifacts.js';

describe('acceptance_specs story-readability consumer scope', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('accepts disposition-only evidence for the criteria extractable from a merged unreadable stories artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'story-readability-consumer-scope-'));
    roots.push(root);
    const stories = `# Stories

## Story 1: Existing merged work

### Happy Path
- Given existing merged work, when BUILD reaches acceptance specs, then its existing proof remains sufficient
`;
    const criteria = extractAuthoritativeStoryCriteria(stories);

    await mkdir(join(root, '.docs', 'stories'), { recursive: true });
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await mkdir(join(root, 'test'), { recursive: true });
    await writeFile(join(root, '.docs', 'stories', 'merged-unreadable.md'), stories);
    await writeFile(join(root, 'test', 'existing-proof.ts'), 'existing proof\n');
    await writeFile(
      join(root, '.pipeline', 'acceptance-specs-red.json'),
      JSON.stringify({
        outcome: 'disposition-only',
        dispositions: criteria.map((criterion) => ({
          criterion,
          disposition: 'existing-sufficient-test',
          citation: 'test/existing-proof.ts:1',
        })),
      }),
    );

    expect(criteria).toEqual([
      'Story 1 happy: Given existing merged work, when BUILD reaches acceptance specs, then its existing proof remains sufficient',
    ]);
    await expect(
      checkStepCompletion(root, 'acceptance_specs', { featureDesc: 'merged-unreadable' }),
    ).resolves.toEqual({ done: true, viaException: false });
  });
});
