import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

const engineStateRenameFailure = vi.hoisted(() => ({ statePath: '', active: false }));

// The build predicate and seedTaskStatus remain real. This is the narrow
// durability boundary whose failure the first scenario needs to exercise.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (source: string, destination: string) => {
      if (engineStateRenameFailure.active && destination === engineStateRenameFailure.statePath) {
        throw new Error('injected engine-state rename refusal');
      }
      return actual.rename(source, destination);
    },
  };
});

const { checkStepCompletion } = await import('../../src/engine/artifacts.js');
const { planTaskDigests } = await import('../../src/engine/plan-task-parse.js');

const ORIGINAL_PLAN = '# Plan\n\n## Task 1: Original task\nImplement the original behavior.\n';
const REWRITTEN_PLAN = '# Plan\n\n## Task 1: Original task\nImplement the amended behavior.\n';

describe('build completion fails closed when plan-amendment reopen cannot persist', () => {
  let dir: string;
  let planPath: string;
  let statePath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'build-seed-failure-'));
    planPath = join(dir, '.docs/plans/feature.md');
    statePath = join(dir, '.pipeline/engine-state.json');
    engineStateRenameFailure.statePath = statePath;
    engineStateRenameFailure.active = false;

    await execa('git', ['init', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: dir });
    await fs.mkdir(join(dir, '.docs/plans'), { recursive: true });
    await fs.mkdir(join(dir, '.pipeline'), { recursive: true });
    await fs.writeFile(planPath, ORIGINAL_PLAN);
    await fs.writeFile(
      join(dir, '.pipeline/task-status.json'),
      JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }),
    );
    await fs.writeFile(join(dir, 'work.txt'), 'completed before the amendment\n');
    await execa('git', ['add', '.'], { cwd: dir });
    await execa('git', ['commit', '-m', 'feat: old task completion\n\nTask: 1'], { cwd: dir });

    const originalDigest = planTaskDigests(ORIGINAL_PLAN).get('1');
    await fs.writeFile(
      statePath,
      JSON.stringify({
        activePlanPath: '.docs/plans/feature.md',
        taskDigests: { version: 1, byPlan: { '.docs/plans/feature.md': { '1': originalDigest } } },
      }),
    );
    await fs.writeFile(planPath, REWRITTEN_PLAN);
  });

  afterEach(async () => {
    engineStateRenameFailure.active = false;
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function checkBuild() {
    return checkStepCompletion(dir, 'build', { projectRoot: dir, planPath });
  }

  async function storedDigest(): Promise<string | undefined> {
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    return state.taskDigests.byPlan['.docs/plans/feature.md']['1'];
  }

  it('reports an engine-state write failure as a reopen failure, leaves its digest unchanged, and retries on the next seed', async () => {
    const originalDigest = await storedDigest();
    engineStateRenameFailure.active = true;

    await expect(checkBuild()).resolves.toMatchObject({
      done: false,
      reason: expect.stringMatching(/^task reopen failed: .*injected engine-state rename refusal/),
    });
    expect(await storedDigest()).toBe(originalDigest);

    engineStateRenameFailure.active = false;
    await expect(checkBuild()).resolves.toMatchObject({
      done: false,
      reason: expect.not.stringMatching(/^task reopen failed:/),
    });
    expect(await storedDigest()).toBe(planTaskDigests(REWRITTEN_PLAN).get('1'));
  });

  it('reports malformed repair obligations as a reopen failure, leaves its digest unchanged, and retries after the state is repaired', async () => {
    const originalDigest = await storedDigest();
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    await fs.writeFile(statePath, JSON.stringify({ ...state, repairObligations: 'malformed' }));

    await expect(checkBuild()).resolves.toMatchObject({
      done: false,
      reason: expect.stringMatching(/^task reopen failed: .*repairObligations section is incompatible/),
    });
    expect(await storedDigest()).toBe(originalDigest);

    await fs.writeFile(statePath, JSON.stringify(state));
    await expect(checkBuild()).resolves.toMatchObject({
      done: false,
      reason: expect.not.stringMatching(/^task reopen failed:/),
    });
    expect(await storedDigest()).toBe(planTaskDigests(REWRITTEN_PLAN).get('1'));
  });
  it('keeps the neutral seed reason for malformed repair obligations when no task changed', async () => {
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    await fs.writeFile(planPath, ORIGINAL_PLAN);
    await fs.writeFile(statePath, JSON.stringify({ ...state, repairObligations: 'malformed' }));

    await expect(checkBuild()).resolves.toMatchObject({
      done: false,
      reason: expect.stringMatching(/^failed to seed task-status from plan: .*repairObligations section is incompatible/),
    });
  });
});
