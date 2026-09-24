// Covers: task:5
/**
 * The sweep-only test-only judgement exception must never reach the two
 * non-sweep resolver entry points: the conductor's finish-time `rebase` step
 * and the daemon re-kick play-forward (`resumeRebaseFirst`). Both route through
 * `runGatedRebaseResolution`, so each is driven over a real test-only conflict
 * in a private repository with a stub resolver that records its context.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { Conductor, type StepRunner, type StepRunResult } from '../../src/engine/conductor.js';
import { REKICK_SENTINEL, resumeRebaseFirst } from '../../src/engine/daemon-rekick.js';
import { createProtectedArtifactSeal } from '../../src/engine/protected-artifact-seal.js';
import type { ResolutionAttempt, ResolutionContext } from '../../src/engine/rebase.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const execFile = promisify(execFileCb);
const INTENT_REASON = 'intent conflict in spec.test.ts: both sides assert a different value';

describe('sweep judgement exception never reaches finish-time or re-kick resolution', () => {
  let repo: string;
  const git = (args: string[]) => execFile('git', args, { cwd: repo });

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'rebase-judgement-boundary-'));
    await initTestRepo(repo);
    await writeFile(join(repo, 'spec.test.ts'), 'base\n');
    await git(['add', '.']);
    await git(['commit', '-q', '-m', 'init']);
    await git(['checkout', '-q', '-b', 'feat']);
    await writeFile(join(repo, 'spec.test.ts'), 'feature\n');
    await git(['commit', '-q', '-am', 'test: feature assertion']);
    await git(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'spec.test.ts'), 'upstream\n');
    await git(['commit', '-q', '-am', 'main: upstream assertion']);
    await git(['checkout', '-q', 'feat']);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  const recordingResolver = (seen: ResolutionContext[]) => async (ctx: ResolutionContext): Promise<ResolutionAttempt> => {
    seen.push(ctx);
    return { resolved: false, reason: INTENT_REASON };
  };

  it('S2.4: the finish-time rebase step dispatches a test-only conflict without the exception and halts as before', async () => {
    const statePath = join(repo, 'conduct-state.json');
    const state: ConductState = {};
    for (const step of ALL_STEPS) {
      if (step.name === 'rebase') break;
      (state as Record<string, unknown>)[step.name] = 'done';
    }
    (state as Record<string, unknown>).finish = 'done';
    await writeState(statePath, state);
    const baselineCommit = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit });

    const seen: ResolutionContext[] = [];
    const runner: StepRunner = {
      run: vi.fn().mockResolvedValue({ success: true } satisfies StepRunResult),
      resolveRebaseConflict: recordingResolver(seen),
    };
    await new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: repo,
      daemon: true,
      mode: 'auto',
      fromStep: 'rebase',
    }).run();

    expect(seen).toHaveLength(1);
    expect(seen[0].conflicts).toEqual(['spec.test.ts']);
    expect(seen[0].supersessionJudgement).toBe(false);
    await expect(readFile(join(repo, '.pipeline/HALT'), 'utf8')).resolves.toContain(INTENT_REASON);
  });

  it('S2.5: the daemon re-kick play-forward dispatches a test-only conflict without the exception', async () => {
    await mkdir(join(repo, '.pipeline'), { recursive: true });
    await writeFile(join(repo, REKICK_SENTINEL), 'rekick\n');

    const seen: ResolutionContext[] = [];
    const result = await resumeRebaseFirst({
      worktreePath: repo,
      localBase: 'main',
      events: new ConductorEventEmitter(),
      ranManualTest: false,
      resolveAttempts: 1,
      resolveConflict: recordingResolver(seen),
    });

    expect(result).toBe('halted');
    expect(seen).toHaveLength(1);
    expect(seen[0].conflicts).toEqual(['spec.test.ts']);
    expect(seen[0].supersessionJudgement).toBe(false);
  });
});
