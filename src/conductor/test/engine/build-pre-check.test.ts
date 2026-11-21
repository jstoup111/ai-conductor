// Covers: task:2, task:3, task:5
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkStepCompletion, type CompletionContext } from '../../src/engine/artifacts.js';
import { buildRetryHint, isNoTaskProgressBuildStall } from '../../src/engine/conductor.js';
import { BUILD_PRE_CHECK_FAILED_PREFIX, runBuildPreCheck } from '../../src/engine/build-pre-check.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { initTestRepo } from '../fixtures/git-repo.js';
import { Conductor } from '../test-conductor.js';
import { seedCleanFeatureSimplifyRecord } from '../fixtures/feature-simplify-record.js';

type PreCheckMethods = { buildPreCheckMissReason(): Promise<string | null> };

describe('BUILD runs the configured test_suite pre-check', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'build-pre-check-'));
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await seedCleanFeatureSimplifyRecord(root);
    await writeFile(join(root, '.docs', 'plans', 'feature.md'), '### Task T1: First\n### Task T2: Second\n');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeStatus(second: 'completed' | 'pending'): Promise<void> {
    await writeFile(
      join(root, '.pipeline', 'task-status.json'),
      JSON.stringify({
        tasks: [
          { id: 'T1', status: 'completed' },
          { id: 'T2', status: second },
        ],
      }),
    );
  }

  function context(extra: CompletionContext = {}): CompletionContext {
    return { projectRoot: root, planPath: join(root, '.docs', 'plans', 'feature.md'), ...extra };
  }

  it('passes when every pre-check command exits zero, and BUILD completes', async () => {
    await writeStatus('completed');
    const miss = await runBuildPreCheck(root, {
      command: 'npm test',
      pre_check: [{ command: 'true' }, { command: 'echo ok' }],
    });

    expect(miss).toBeNull();
    await expect(checkStepCompletion(root, 'build', context({ buildPreCheck: async () => miss }))).resolves.toEqual({
      done: true,
    });
  });

  it('withholds BUILD with the failing command and the tail of its output', async () => {
    await writeStatus('completed');
    const miss = await runBuildPreCheck(root, {
      command: 'npm test',
      pre_check: [{ command: 'true' }, { command: 'echo first line; echo "TS2322: type error here"; exit 2' }],
    });

    expect(miss?.startsWith(BUILD_PRE_CHECK_FAILED_PREFIX)).toBe(true);
    expect(miss).toContain('exit 2');
    expect(miss).toContain('TS2322: type error here');
    await expect(checkStepCompletion(root, 'build', context({ buildPreCheck: async () => miss }))).resolves.toEqual({
      done: false,
      reason: miss,
    });
  });

  it('runs nothing when no pre-check is configured, and an absent probe does not block BUILD', async () => {
    await writeStatus('completed');
    const marker = join(root, 'ran');

    await expect(runBuildPreCheck(root, { command: `touch ${marker}` })).resolves.toBeNull();
    await expect(readFile(marker)).rejects.toThrow();
    await expect(checkStepCompletion(root, 'build', context())).resolves.toEqual({ done: true });
  });

  it('never runs the pre-check while a task is unresolved', async () => {
    await writeStatus('pending');
    const probe = vi.fn(async () => `${BUILD_PRE_CHECK_FAILED_PREFIX} x`);

    const result = await checkStepCompletion(root, 'build', context({ buildPreCheck: probe }));
    expect(result.done).toBe(false);
    expect(result.reason).toContain('T2');
    expect(probe).not.toHaveBeenCalled();
  });

  it('never runs the pre-check while paths are uncommitted', async () => {
    await writeStatus('completed');
    const probe = vi.fn(async () => `${BUILD_PRE_CHECK_FAILED_PREFIX} x`);

    const result = await checkStepCompletion(
      root,
      'build',
      context({
        buildPreCheck: probe,
        worktreeStatus: async () => ' M src/a.ts\n',
      }),
    );
    expect(result.missing).toBe('uncommitted');
    expect(probe).not.toHaveBeenCalled();
  });

  it('holds a PASS for its HEAD and re-runs once HEAD moves', async () => {
    await initTestRepo(root);
    const commit = async (name: string) => {
      await writeFile(join(root, name), name);
      await execa('git', ['add', name], { cwd: root });
      await execa('git', ['commit', '-m', name], { cwd: root });
    };
    await commit('a.txt');
    const counter = join(root, '.pipeline', 'count');
    const conductor = new Conductor({
      stateFilePath: join(root, 'conduct-state.json'),
      stepRunner: { run: vi.fn(), runInteractive: vi.fn() },
      events: new ConductorEventEmitter(),
      projectRoot: root,
      config: { test_suite: { command: 'npm test', pre_check: [{ command: `echo x >> ${counter}` }] } },
    }) as unknown as PreCheckMethods;
    const runs = async () => (await readFile(counter, 'utf8')).trim().split('\n').length;

    await expect(conductor.buildPreCheckMissReason()).resolves.toBeNull();
    await expect(conductor.buildPreCheckMissReason()).resolves.toBeNull();
    expect(await runs()).toBe(1);

    await commit('b.txt');
    await expect(conductor.buildPreCheckMissReason()).resolves.toBeNull();
    expect(await runs()).toBe(2);
  });

  it('steers the retry to repair the failure without running the aggregate suite', () => {
    const reason = `${BUILD_PRE_CHECK_FAILED_PREFIX} \`npm run typecheck\` (src/conductor) nonzero_exit; output tail:\nsrc/a.ts(3,1): error TS2322`;
    const hint = buildRetryHint('build', reason);

    expect(hint).toContain('src/a.ts(3,1): error TS2322');
    expect(hint).toContain('fix');
    expect(hint).toContain('commit');
    expect(hint).toContain('`test_suite` owns the aggregate suite');
  });

  it('exempts the pre-check miss from the no-task-progress stall but not a pending-task miss', () => {
    const counts = { attempt: 2, resolvedTasksBefore: 2, resolvedTasksAfter: 2, headMovedThisAttempt: false };

    expect(isNoTaskProgressBuildStall({ ...counts, completionReason: `${BUILD_PRE_CHECK_FAILED_PREFIX} x` })).toBe(
      false,
    );
    expect(isNoTaskProgressBuildStall({ ...counts, completionReason: '1/3 tasks pending/not completed: 2' })).toBe(
      true,
    );
  });
});
