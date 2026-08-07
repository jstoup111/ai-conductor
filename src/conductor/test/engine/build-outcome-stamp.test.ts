import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ConductState } from '../../src/types/index.js';
import { Conductor } from '../test-conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

vi.mock('../../src/engine/project-prelude.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/engine/project-prelude.js')>()),
  currentCommitSha: vi.fn(async () => 'head-before-build'),
  currentTreeHash: vi.fn(async () => 'tree-before-build'),
}));

import * as projectPrelude from '../../src/engine/project-prelude.js';

describe('conductor build-outcome baseline capture', () => {
  let dir: string;
  let statePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-build-outcome-'));
    statePath = join(dir, 'conduct-state.json');
    await writeFile(statePath, JSON.stringify({
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done',
      coherence_check: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
      complexity_tier: 'S',
    } satisfies ConductState));
    vi.mocked(projectPrelude.currentCommitSha).mockClear();
    vi.mocked(projectPrelude.currentTreeHash).mockClear();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('captures the tree baseline beside the build-entry HEAD probe through the git boundary', async () => {
    const runner: StepRunner = {
      run: vi.fn(async () => ({ success: false, output: 'stop after build entry' })),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      fromStep: 'build',
      maxRetries: 1,
    });

    await conductor.run();

    expect(projectPrelude.currentCommitSha).toHaveBeenCalledWith(dir);
    expect(projectPrelude.currentTreeHash).toHaveBeenCalledWith(dir);
  });

  it('keeps one build-step-entry baseline probe block', async () => {
    const source = await readFile(
      new URL('../../src/engine/conductor.ts', import.meta.url),
      'utf8',
    );

    expect(source.match(/const \[headShaBeforeBuild, treeHashBeforeBuild\]/g)).toHaveLength(1);
  });
});
