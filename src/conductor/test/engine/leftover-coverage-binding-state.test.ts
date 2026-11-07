import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readAllVerdicts } from '../../src/engine/gate-verdicts.js';
import { findResumeIndex } from '../../src/engine/resume-entry.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState } from '../../src/types/index.js';

describe('leftover coverage_binding state', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('does not expose a retired verdict to selector and resume consumers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'retired-coverage-state-'));
    dirs.push(root);
    await mkdir(join(root, '.pipeline', 'gates'), { recursive: true });
    await Promise.all([
      writeFile(join(root, '.pipeline', 'gates', 'coverage_binding.json'), '{"satisfied":false}\n'),
      writeFile(join(root, '.pipeline', 'gates', 'build.json'), '{"satisfied":true}\n'),
    ]);

    const state = {
      coverage_binding: 'stale',
      build: 'done',
    } as unknown as ConductState;
    const verdicts = await readAllVerdicts(root);

    expect(verdicts).toEqual({ build: { satisfied: true } });
    expect(findResumeIndex(state, ALL_STEPS)).toBe(ALL_STEPS.findIndex((step) => step.name === 'test_suite'));
  });
});
