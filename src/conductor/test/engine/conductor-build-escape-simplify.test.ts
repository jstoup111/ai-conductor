// Covers: task:3
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { StepRunner } from '../../src/engine/conductor.js';
import type { StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { initTestRepo } from '../fixtures/git-repo.js';
import { Conductor } from '../test-conductor.js';

// The retries-exhausted escape (`anyAttemptMovedHead`) routes a commit-moving
// BUILD to build_review. adr-2026-08-03 D9 puts the whole-feature simplify
// floor on that door as well as on the completion gate.

type MockRunner = StepRunner & { run: ReturnType<typeof vi.fn>; runInteractive: ReturnType<typeof vi.fn> };

async function commit(dir: string, file: string, message: string): Promise<void> {
  await writeFile(join(dir, file), `${file}\n`);
  await execa('git', ['add', file], { cwd: dir });
  await execa('git', ['commit', '-m', message], { cwd: dir });
}

async function seedDecideArtifacts(dir: string): Promise<void> {
  const artifacts: Array<[string, string]> = [
    ['.docs/decisions/technical-assessment-2026-07-23.md', 'x'],
    ['.docs/specs/2026-07-23-feature.md', 'x'],
    ['.docs/stories/epic-1/a.md', 'x'],
    ['.docs/conflicts/2026-07-23.md', 'x'],
    ['.docs/architecture/arch.md', 'x'],
    ['.docs/decisions/adr-001.md', 'x'],
    ['.docs/coherence/coherence.md', 'x'],
    ['spec/acceptance/feature_spec.rb', 'x'],
    [
      '.pipeline/acceptance-specs-red.json',
      JSON.stringify({
        outcome: 'specs-generated',
        command: 'bundle exec rspec spec/acceptance',
        targetSpecs: ['spec/acceptance/feature_spec.rb'],
        executed: 1,
        passed: 0,
        failed: 1,
        skipped: 0,
        errors: 0,
        failingTests: [{ name: 'feature acceptance contract', reason: 'expected behavior is not implemented' }],
        ranAt: '2026-08-10T00:00:00.000Z',
        intentRationale: 'The fixture records an executed, failing feature acceptance spec.',
      }),
    ],
    ['.docs/plans/2026-07-23-plan.md', '# Plan\n\n### Task 1: Step 1\n\n### Task 2: Step 2\n'],
    [
      '.pipeline/task-status.json',
      JSON.stringify({
        tasks: [
          { id: 1, status: 'pending' },
          { id: 2, status: 'pending' },
        ],
      }),
    ],
  ];
  for (const [rel, content] of artifacts) {
    const full = join(dir, rel);
    await mkdir(full.substring(0, full.lastIndexOf('/')), { recursive: true });
    await writeFile(full, content);
  }
  await execa('git', ['add', '.docs', 'spec'], { cwd: dir });
  await execa('git', ['commit', '-m', 'docs: approve decide artifacts'], { cwd: dir });
}

describe('retries-exhausted escape honors the whole-feature simplify floor', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;
  let stepStarts: StepName[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-escape-simplify-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    stepStarts = [];
    events.on('step_started', (e) => {
      if (e.type === 'step_started') stepStarts.push(e.step);
    });
    await initTestRepo(dir);
    await commit(dir, 'README.md', 'Initial commit');
    await seedDecideArtifacts(dir);
    await writeState(statePath, { plan_review: 'done' });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function conductor(runner: MockRunner): Conductor {
    return new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 3,
    });
  }

  it('halts naming the missing pass instead of routing a resolved, committing build without a record', async () => {
    let seq = 0;
    const runner: MockRunner = {
      run: vi.fn().mockImplementation(async (step: StepName) => {
        if (step === 'build') {
          seq++;
          await commit(dir, `work-${seq}.txt`, `feat: work ${seq}\n\nTask: 1\nTask: 2\n`);
        }
        return { success: true };
      }),
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };

    await conductor(runner).run();

    expect(seq).toBeGreaterThan(1);
    expect(stepStarts).not.toContain('build_review');
    const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf8');
    expect(halt).toContain('whole-feature simplify pass required:');
  });

  it('routes a committing build with an unresolved task forward when its record is CLEAN', async () => {
    await mkdir(join(dir, '.pipeline/audit-trail'), { recursive: true });
    await writeFile(join(dir, '.pipeline/audit-trail/feature-simplification.md'), '## Verdict: CLEAN\n');
    let seq = 0;
    const runner: MockRunner = {
      run: vi.fn().mockImplementation(async (step: StepName) => {
        if (step === 'build') {
          seq++;
          await commit(dir, `work-${seq}.txt`, `feat: work ${seq}\n\nTask: 1\n`);
        }
        return { success: true };
      }),
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };

    await conductor(runner).run();

    expect(stepStarts).toContain('build_review');
  });
});
