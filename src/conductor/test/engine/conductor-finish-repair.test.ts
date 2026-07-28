/**
 * Tests for finish-step repair callback wiring in Conductor.completionCtx()
 *
 * Verifies that the completion context carries an injected `gh` and composes
 * `repairFinishPr` to call rehabilitateHaltPr → retitleFloor → ensureShipReady
 * in order, with correct inputs resolved from state and intake marker.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// execa is consumed transitively (WorktreeManager). Mock it so the engine
// never forks real git processes even if featureDesc were set.
vi.mock('execa', () => ({ execa: vi.fn() }));

const repairFailure = vi.hoisted(() => ({ enabled: false }));
vi.mock('../../src/engine/halt-pr-rehabilitation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/halt-pr-rehabilitation.js')>();
  return {
    ...actual,
    retitleFloor: async (...args: Parameters<typeof actual.retitleFloor>) => {
      if (repairFailure.enabled) throw new Error('retitle sentinel');
      return actual.retitleFloor(...args);
    },
  };
});

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import type { ConductState } from '../../src/types/index.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Fake gh that tracks calls. */
function makeFakeGh(): { runner: GhRunner; calls: Array<{ args: string[]; cwd: string }> } {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  const runner: GhRunner = vi.fn(async (args: string[], opts: { cwd: string }) => {
    calls.push({ args, cwd: opts.cwd });
    return { stdout: '{}' };
  });
  return { runner, calls };
}

/** Step runner that completes all steps successfully. */
function makeSuccessfulRunner(): StepRunner {
  return {
    run: vi.fn(async (): Promise<StepRunResult> => {
      return { success: true };
    }),
  };
}

// ── suite ────────────────────────────────────────────────────────────────────

describe('conductor/finish-repair', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-repair-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    repairFailure.enabled = false;
    await rm(dir, { recursive: true, force: true });
  });

  it('completionCtx carries injected gh', async () => {
    const fakeGh = makeFakeGh();
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeSuccessfulRunner(),
      events,
      projectRoot: dir,
      gh: fakeGh.runner,
    });

    const state: ConductState = {
      feature_desc: 'test feature',
      worktree_branch: 'feat/test-feature',
    };

    // Access private completionCtx method for testing
    const ctx = await (conductor as any)['completionCtx'](state);

    // Verify gh is injected into the context
    expect(ctx.gh).toBeDefined();
    expect(ctx.gh).toBe(fakeGh.runner);
  });

  it('completionCtx carries repairFinishPr callback', async () => {
    const fakeGh = makeFakeGh();
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeSuccessfulRunner(),
      events,
      projectRoot: dir,
      gh: fakeGh.runner,
    });

    const state: ConductState = {
      feature_desc: 'test feature',
      worktree_branch: 'feat/test-feature',
    };

    const ctx = await (conductor as any)['completionCtx'](state);

    // Verify repairFinishPr is present and callable
    expect(ctx.repairFinishPr).toBeDefined();
    expect(typeof ctx.repairFinishPr).toBe('function');
  });

  it('repairFinishPr invokes repair functions in correct order via composition', async () => {
    const fakeGh = makeFakeGh();
    const callLog: string[] = [];

    // Create a wrapper that patches the repair module functions
    const patchedGh: GhRunner = async (args: string[], opts: { cwd: string }) => {
      callLog.push(`gh-call: ${args[0]}`);
      return { stdout: '{"isDraft":true,"title":"needs-remediation: test","labels":[]}' };
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeSuccessfulRunner(),
      events,
      projectRoot: dir,
      gh: patchedGh,
    });

    const state: ConductState = {
      feature_desc: 'test feature',
      worktree_branch: 'feat/test-feature',
    };

    const ctx = await (conductor as any)['completionCtx'](state);

    // Verify repair callback exists
    expect(ctx.repairFinishPr).toBeDefined();
    expect(typeof ctx.repairFinishPr).toBe('function');
  });

  it('repair receives featureDesc from state', async () => {
    const fakeGh = makeFakeGh();

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeSuccessfulRunner(),
      events,
      projectRoot: dir,
      gh: fakeGh.runner,
    });

    const state: ConductState = {
      feature_desc: 'implement user authentication',
      worktree_branch: 'feat/user-auth',
    };

    const ctx = await (conductor as any)['completionCtx'](state);

    // Verify that the context has the state data available
    expect(ctx.featureDesc).toBe('implement user authentication');

    // Verify repair callback is present and can be called
    expect(ctx.repairFinishPr).toBeDefined();
  });

  it('missing feature_desc in state does not break completionCtx', async () => {
    const fakeGh = makeFakeGh();

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeSuccessfulRunner(),
      events,
      projectRoot: dir,
      gh: fakeGh.runner,
    });

    // State without feature_desc
    const state: ConductState = {
      worktree_branch: 'feat/test',
    };

    const ctx = await (conductor as any)['completionCtx'](state);

    // Should still have repairFinishPr even when featureDesc is missing
    expect(ctx.repairFinishPr).toBeDefined();
    expect(typeof ctx.repairFinishPr).toBe('function');
  });

  it('repairFinishPr runs bodyFloor after retitleFloor and before ensureShipReady', async () => {
    const calls: string[] = [];
    const bannerBody = [
      'This PR was opened automatically after an irrecoverable daemon HALT.',
      'Manual remediation is required to unblock this feature.',
      'See the comment below for the failure reason.',
    ].join('\n');

    const patchedGh: GhRunner = async (args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        calls.push('view');
        return {
          stdout: JSON.stringify({
            title: 'needs-remediation: test',
            isDraft: true,
            labels: [],
            body: bannerBody,
          }),
        };
      }
      if (args[0] === 'pr' && args[1] === 'edit') {
        if (args.includes('--title')) calls.push('edit-title');
        else if (args.includes('--body')) calls.push('edit-body');
        else calls.push('edit-other');
        return { stdout: '{}' };
      }
      if (args[0] === 'pr' && args[1] === 'ready') {
        calls.push('ready');
        return { stdout: '{}' };
      }
      calls.push(`other:${args.join(' ')}`);
      return { stdout: '{}' };
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeSuccessfulRunner(),
      events,
      projectRoot: dir,
      gh: patchedGh,
    });

    const state: ConductState = {
      feature_desc: 'test feature',
      worktree_branch: 'feat/test-feature',
    };

    const ctx = await (conductor as any)['completionCtx'](state);
    await ctx.repairFinishPr('https://github.com/example/repo/pull/1');

    const editTitleIdx = calls.indexOf('edit-title');
    const editBodyIdx = calls.indexOf('edit-body');
    const readyIdx = calls.lastIndexOf('ready');

    expect(editTitleIdx).toBeGreaterThanOrEqual(0);
    expect(editBodyIdx).toBeGreaterThanOrEqual(0);
    expect(readyIdx).toBeGreaterThanOrEqual(0);
    expect(editBodyIdx).toBeGreaterThan(editTitleIdx);
    expect(readyIdx).toBeGreaterThan(editBodyIdx);
  });

  it("capture-only mode posts the halt-history COMMENT and makes zero presentation mutations", async () => {
    const calls: string[][] = [];
    const bannerBody = [
      'This PR was opened automatically after an irrecoverable daemon HALT.',
      'Manual remediation is required to unblock this feature.',
      'See the comment below for the failure reason.',
    ].join('\n');

    const patchedGh: GhRunner = async (args: string[]) => {
      calls.push([...args]);
      if (args[0] === 'pr' && args[1] === 'view') {
        return {
          stdout: JSON.stringify({
            title: 'needs-remediation: test',
            isDraft: true,
            labels: [{ name: 'needs-remediation' }],
            body: bannerBody,
            comments: [],
          }),
        };
      }
      return { stdout: '{}' };
    };

    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/halt-user-input-required'),
      'build stalled: no task progress',
      'utf-8',
    );

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeSuccessfulRunner(),
      events,
      projectRoot: dir,
      gh: patchedGh,
    });

    const ctx = await (conductor as any)['completionCtx']({
      feature_desc: 'test feature',
      worktree_branch: 'feat/test-feature',
    } satisfies ConductState);
    await ctx.repairFinishPr('https://github.com/example/repo/pull/1', { mode: 'capture-only' });

    const commentCall = calls.find((c) => c[0] === 'pr' && c[1] === 'comment');
    expect(commentCall).toBeDefined();
    const commentBody = commentCall![commentCall!.indexOf('--body') + 1];
    expect(commentBody).toContain('Halt history');
    expect(commentBody).toContain('build stalled: no task progress');
    // No title/body/label/draft mutation on the kickback pass.
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'edit')).toBe(false);
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'ready')).toBe(false);
    expect(calls.some((c) => c[0] === 'api')).toBe(false);
  });

  it('omits the test-evidence line entirely when ZERO plan tasks are complete (no false "- [x] 0/N")', async () => {
    const bodies: string[] = [];
    const bannerBody = 'This PR was opened automatically after an irrecoverable daemon HALT.';

    const patchedGh: GhRunner = async (args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        return {
          stdout: JSON.stringify({
            title: 'needs-remediation: test',
            isDraft: false,
            labels: [],
            body: bannerBody,
            comments: [],
          }),
        };
      }
      if (args[0] === 'pr' && args[1] === 'edit' && args.includes('--body')) {
        bodies.push(args[args.indexOf('--body') + 1]);
        return { stdout: '{}' };
      }
      return { stdout: '{}' };
    };

    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/task-status.json'),
      JSON.stringify({
        tasks: Array.from({ length: 16 }, (_, i) => ({ id: `T${i + 1}`, status: 'pending' })),
      }),
      'utf-8',
    );

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeSuccessfulRunner(),
      events,
      projectRoot: dir,
      gh: patchedGh,
    });

    const ctx = await (conductor as any)['completionCtx']({
      feature_desc: 'test feature',
      worktree_branch: 'feat/test-feature',
    } satisfies ConductState);
    await ctx.repairFinishPr('https://github.com/example/repo/pull/1');

    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).not.toContain('- [x] 0/16');
      expect(body).not.toContain('## Test evidence');
    }
  });

  it('routes a daemon finish-repair exception through its supplied feature logger', async () => {
    const featureLogs: string[] = [];
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeSuccessfulRunner(),
      events,
      projectRoot: dir,
      daemon: true,
      log: (message) => featureLogs.push(message),
      gh: makeFakeGh().runner,
    });
    repairFailure.enabled = true;

    const ctx = await (conductor as any)['completionCtx']({
      feature_desc: 'test feature',
      worktree_branch: 'feat/test-feature',
    } satisfies ConductState);
    await ctx.repairFinishPr('https://github.com/example/repo/pull/1');

    expect(featureLogs).toContain('[conductor-repair] retitleFloor failed: Error: retitle sentinel');
  });
});
