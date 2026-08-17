/**
 * Acceptance coverage for Story 4: lowest-sufficient test dispositions.
 *
 * The observable boundary is the acceptance_specs completion gate. A feature
 * whose criteria are all assigned to existing or planned lower-layer tests
 * must be able to proceed without fabricating an acceptance spec that only
 * mirrors prose. An incomplete disposition must continue to fail closed.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkStepCompletion } from '../../src/engine/artifacts.js';

const DISPOSITION_PATH = '.pipeline/acceptance-specs-disposition.json';

describe('acceptance_specs honors lowest-sufficient coverage dispositions', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lowest-sufficient-acceptance-'));
    await mkdir(join(root, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeDisposition(criteria: Array<Record<string, string>>): Promise<void> {
    await writeFile(
      join(root, DISPOSITION_PATH),
      JSON.stringify({
        decision: 'no-acceptance-specs',
        rationale:
          'Every criterion is sufficiently covered below the acceptance layer; no distinct multi-step flow exists.',
        criteria,
      }),
      'utf-8',
    );
  }

  it('completes without a fabricated spec when every criterion has lower-layer coverage', async () => {
    await writeDisposition([
      {
        criterion: 'Story 4 HP2',
        disposition: 'unit-covered',
        evidence: 'Task 7 RED/GREEN test',
      },
      {
        criterion: 'Story 4 NP2',
        disposition: 'already-tested',
        evidence: 'test/engine/artifacts.acceptance-specs.test.ts',
      },
    ]);

    await expect(checkStepCompletion(root, 'acceptance_specs')).resolves.toEqual({
      done: true,
      viaException: false,
    });
  });

  it('fails closed when any criterion lacks a sufficient coverage disposition', async () => {
    await writeDisposition([
      {
        criterion: 'Story 4 HP2',
        disposition: 'unit-covered',
        evidence: 'Task 7 RED/GREEN test',
      },
      {
        criterion: 'Story 4 NP1',
        disposition: 'unresolved',
        evidence: '',
      },
    ]);

    const result = await checkStepCompletion(root, 'acceptance_specs');

    expect(result.done).toBe(false);
    expect(result.reason).toMatch(/Story 4 NP1|unresolved|coverage disposition/i);
  });
});
