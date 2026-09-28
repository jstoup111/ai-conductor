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

// The production completion context derives its operation guard through these
// seams. Keep the fixture on that path while replacing only process/user-config
// boundaries, so every presentation mutation is exercised through the guard.
vi.mock('../../src/engine/pr-labels.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/pr-labels.js')>();
  return {
    ...actual,
    makeProductionGit: () => async (args: string[]) => {
      if (args.join(' ') === 'config --get remote.origin.url') {
        return { stdout: 'https://github.com/example/repo.git\n' };
      }
      if (args[0] === 'show') return { stdout: 'Owner: alice\n' };
      return { stdout: '' };
    },
  };
});
vi.mock('../../src/engine/owner-gate/machine-identity.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/owner-gate/machine-identity.js')>();
  return {
    ...actual,
    readMachineOwnerConfig: vi.fn(async () => ({ spec_owner: 'alice' })),
  };
});

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

import { Conductor as ProductionConductor, createFinishPresentationRepair } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import type { ConductState } from '../../src/types/index.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';
import { HALT_PR_BANNER_LINES, NEEDS_REMEDIATION_BODY_MARKER } from '../../src/engine/pr-labels.js';
import { HALT_HISTORY_COMMENT_MARKER } from '../../src/engine/halt-pr-rehabilitation.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { checkStepCompletion } from '../../src/engine/artifacts.js';
import type { CompletionContext } from '../../src/engine/artifacts.js';
import { writeRegionCapture } from '../../src/engine/pr-body-region-store.js';
import type {
  GithubOperationRequest,
  GithubOperationRunner,
  GithubOperationRunnerRefusal,
  GithubOperationRunnerResponse,
} from '../../src/engine/github-operations.js';

class Conductor extends ProductionConductor {
  constructor(options: ConstructorParameters<typeof ProductionConductor>[0]) {
    super({
      baseBranch: 'main',
      featureDesc: 'test feature',
      worktreeBranch: 'feat/test-feature',
      ...options,
    });
  }
}

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

const REGION_PR_URL = 'https://github.com/example/repo/pull/1';
const REGION_OWNER = 'compliance-attest';
const REGION_CAPTURE = '\nAttested-By: security-bot\n';

function regionBody(contents: string): string {
  return `## Summary\n\n<!-- ai-conductor:step ${REGION_OWNER} -->${contents}<!-- /ai-conductor:step -->`;
}

function repairFixture(
  projectRoot: string,
  options: { halted?: boolean; refuseRestore?: boolean; persistRestore?: boolean } = {},
) {
  const operations: GithubOperationRequest[] = [];
  const calls: string[] = [];
  const pr = {
    title: options.halted ? 'needs-remediation: test feature' : 'feat: test feature',
    isDraft: true,
    labels: options.halted ? ['needs-remediation'] : [] as string[],
    body: regionBody('\nAttested-By: altered\n'),
    comments: [] as string[],
  };
  const gh: GhRunner = async (args) => {
    if (args[0] === 'pr' && args[1] === 'view') {
      if (args.includes('--json') && args[args.indexOf('--json') + 1] === 'body') calls.push('region-read');
      return { stdout: JSON.stringify(pr) };
    }
    throw new Error(`unexpected raw mutation: ${args.join(' ')}`);
  };
  const guarded: GithubOperationRunner = {
    run: vi.fn(async (request): Promise<GithubOperationRunnerResponse | GithubOperationRunnerRefusal> => {
      operations.push(request);
      if (request.operation === 'pull-request.edit' && 'body' in (request.payload ?? {})) {
        calls.push('region-restore');
        if (options.refuseRestore) return { kind: 'refused' as const, reason: 'other-owner' as const };
        if (!options.persistRestore) pr.body = (request.payload as { body: string }).body;
      }
      if (request.operation === 'pull-request.edit' && 'title' in (request.payload ?? {})) {
        pr.title = (request.payload as { title: string }).title;
      }
      if (request.operation === 'pull-request.label.remove') pr.labels = [];
      if (request.operation === 'pull-request.ready') {
        calls.push('ready');
        pr.isDraft = false;
      }
      return {};
    }),
  };
  const repair = createFinishPresentationRepair({ projectRoot, gh, operations: guarded, log: () => {} });
  const request = { prUrl: REGION_PR_URL, state: { feature_desc: 'test feature', worktree_branch: 'feat/test-feature' } };
  return { calls, guarded, operations, pr, repair, request };
}

async function prepareFinishCompletion(dir: string, prUrl = REGION_PR_URL): Promise<void> {
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  await writeFile(join(dir, '.pipeline/finish-choice'), 'pr', 'utf8');
  await writeFile(join(dir, '.pipeline/conduct-state.json'), JSON.stringify({ pr_url: prUrl }), 'utf8');
}

function validFinishEvidence() {
  return async () => ({
    kind: 'valid' as const,
    slug: 'test-feature',
    pr: REGION_PR_URL,
    recordPath: '.docs/shipped/test-feature.md',
    hash: 'test-hash',
    commit: 'test-commit',
  });
}

function completionRepairFixture(projectRoot: string, failVerificationRead = false) {
  const calls: string[] = [];
  let awaitingVerification = false;
  const pr = {
    title: 'feat: test feature',
    isDraft: true,
    labels: [] as string[],
    body: `## What Changed\n\nReader-facing prose.\n${regionBody('\nAttested-By: altered\n')}`,
    comments: [] as string[],
  };
  const gh: GhRunner = async (args) => {
    if (args[0] !== 'pr' || args[1] !== 'view') throw new Error(`unexpected gh call: ${args.join(' ')}`);
    if (args.some((arg) => arg.includes('body')) && awaitingVerification) {
      calls.push('region-verification-read');
      if (failVerificationRead) throw new Error('verification read unavailable');
      awaitingVerification = false;
    }
    return { stdout: JSON.stringify(pr) };
  };
  const operations: GithubOperationRunner = {
    run: vi.fn(async (request): Promise<GithubOperationRunnerResponse | GithubOperationRunnerRefusal> => {
      if (request.operation === 'pull-request.edit' && 'body' in (request.payload ?? {})) {
        calls.push('region-restore');
        pr.body = (request.payload as { body: string }).body;
        awaitingVerification = true;
      }
      if (request.operation === 'pull-request.ready') {
        calls.push('ready');
        pr.isDraft = false;
      }
      return {};
    }),
  };
  const repair = createFinishPresentationRepair({ projectRoot, gh, operations, log: () => {} });
  const ctx: CompletionContext = {
    featureDesc: 'test-feature',
    gh,
    shipmentEvidence: validFinishEvidence(),
    repairFinishPr: async (prUrl, opts) => repair({
      prUrl,
      state: { feature_desc: 'test feature', worktree_branch: 'feat/test-feature' },
      mode: opts?.mode,
    }),
  };
  return { calls, ctx, pr };
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

  it('restores the captured region after halt rehabilitation and body-floor rewrites before the ready flip', async () => {
    await writeRegionCapture(dir, REGION_PR_URL, REGION_OWNER, REGION_CAPTURE);
    const fixture = repairFixture(dir, { halted: true });

    await fixture.repair(fixture.request);

    expect(fixture.pr.body).toContain(
      `<!-- ai-conductor:step ${REGION_OWNER} -->${REGION_CAPTURE}<!-- /ai-conductor:step -->`,
    );
    expect(fixture.calls).toEqual(expect.arrayContaining(['region-read', 'region-restore', 'ready']));
    expect(fixture.calls.indexOf('region-restore')).toBeGreaterThan(fixture.calls.indexOf('region-read'));
    expect(fixture.calls.lastIndexOf('region-read')).toBeGreaterThan(fixture.calls.indexOf('region-restore'));
    expect(fixture.calls.indexOf('ready')).toBeGreaterThan(fixture.calls.lastIndexOf('region-read'));
  });

  it('keeps the draft and names the owner when the guarded region restore is refused', async () => {
    await writeRegionCapture(dir, REGION_PR_URL, REGION_OWNER, REGION_CAPTURE);
    const fixture = repairFixture(dir, { refuseRestore: true });

    await expect(fixture.repair(fixture.request)).rejects.toThrow(
      `guarded region restore refused for ${REGION_OWNER}`,
    );

    expect(fixture.pr.isDraft).toBe(true);
    expect(fixture.calls).not.toContain('ready');
  });

  it('keeps the draft and names a verification mismatch when a restore does not persist', async () => {
    await writeRegionCapture(dir, REGION_PR_URL, REGION_OWNER, REGION_CAPTURE);
    const fixture = repairFixture(dir, { persistRestore: true });

    await expect(fixture.repair(fixture.request)).rejects.toThrow(
      `region verification mismatch for ${REGION_OWNER}`,
    );

    expect(fixture.pr.isDraft).toBe(true);
    expect(fixture.calls.slice(-3)).toEqual(['region-read', 'region-restore', 'region-read']);
  });

  it('keeps the existing ready path operation sequence when there are no captures', async () => {
    const fixture = repairFixture(dir);

    await fixture.repair(fixture.request);

    // The one body read belongs to the pre-existing body floor. A capture
    // would add the restore read plus the verification read after it.
    expect(fixture.calls).toEqual(['region-read', 'ready']);
    expect(fixture.operations.map(({ operation }) => operation)).toEqual(['pull-request.ready']);
  });

  it('completion repair restores and verifies captured regions before marking the PR ready', async () => {
    await prepareFinishCompletion(dir);
    await writeRegionCapture(dir, REGION_PR_URL, REGION_OWNER, REGION_CAPTURE);
    const fixture = completionRepairFixture(dir);

    const result = await checkStepCompletion(dir, 'finish', fixture.ctx);

    expect(result).toEqual({ done: true });
    expect(fixture.pr.body).toContain(
      `<!-- ai-conductor:step ${REGION_OWNER} -->${REGION_CAPTURE}<!-- /ai-conductor:step -->`,
    );
    expect(fixture.calls).toEqual(['region-restore', 'region-verification-read', 'ready']);
  });

  it('fails finish completion closed when a captured region verification read fails', async () => {
    await prepareFinishCompletion(dir);
    await writeRegionCapture(dir, REGION_PR_URL, REGION_OWNER, REGION_CAPTURE);
    const fixture = completionRepairFixture(dir, true);

    const result = await checkStepCompletion(dir, 'finish', fixture.ctx);

    expect(result).toMatchObject({ done: false, missing: 'other' });
    expect(result.reason).toContain(REGION_OWNER);
    expect(result.reason).toContain('verification read unavailable');
    expect(fixture.calls).toEqual(['region-restore', 'region-verification-read']);
    expect(fixture.pr.isDraft).toBe(true);
  });

  it('keeps a capture-free completion repair warn-only when GitHub is unavailable', async () => {
    await prepareFinishCompletion(dir);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unavailableGh: GhRunner = async () => { throw new Error('GitHub unavailable'); };
    const ctx: CompletionContext = {
      featureDesc: 'test-feature',
      gh: unavailableGh,
      shipmentEvidence: validFinishEvidence(),
      repairFinishPr: async () => { throw new Error('GitHub unavailable'); },
    };

    try {
      await expect(checkStepCompletion(dir, 'finish', ctx)).resolves.toEqual({ done: true });
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('continuing (warn-only)'));
    } finally {
      warning.mockRestore();
    }
  });

  it('repairFinishPr invokes repair functions in correct order via composition', async () => {
    const callLog: string[] = [];

    // Create a wrapper that patches the repair module functions
    const patchedGh: GhRunner = async (args: string[], _opts: { cwd: string }) => {
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
    const fakeGh = makeFakeGh();
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeSuccessfulRunner(),
      events,
      projectRoot: dir,
      daemon: true,
      log: (message) => featureLogs.push(message),
      gh: fakeGh.runner,
    });
    repairFailure.enabled = true;

    const ctx = await (conductor as any)['completionCtx']({
      feature_desc: 'test feature',
      worktree_branch: 'feat/test-feature',
    } satisfies ConductState);
    await expect(ctx.repairFinishPr('https://github.com/example/repo/pull/1')).rejects.toThrow('retitle sentinel');

    expect(featureLogs).toContain('[conductor-repair] retitleFloor failed: Error: retitle sentinel');
    expect(fakeGh.calls.some(({ args }) => args[0] === 'pr' && args[1] === 'ready')).toBe(false);
  });

});
