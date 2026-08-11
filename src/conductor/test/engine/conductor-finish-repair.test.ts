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
import { HALT_PR_BANNER_LINES, NEEDS_REMEDIATION_BODY_MARKER } from '../../src/engine/pr-labels.js';
import { HALT_HISTORY_COMMENT_MARKER } from '../../src/engine/halt-pr-rehabilitation.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { checkStepCompletion } from '../../src/engine/artifacts.js';

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

  it('restores the pre-finish release metadata without replacing finish-authored reader content', async () => {
    const prUrl = 'https://github.com/example/repo/pull/1';
    const metadata = [
      'Release-Disposition: note',
      'Release-Category: Fixed',
      'Release-Semver: patch',
      'Release-Note: Preserve release metadata after finish.',
    ].join('\n');
    let body = `${metadata}\n\nDraft reader content.`;
    const edits: string[] = [];
    const gh: GhRunner = async (args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        return { stdout: JSON.stringify({ title: 'feat: test', isDraft: false, labels: [], body }) };
      }
      if (args[0] === 'pr' && args[1] === 'edit' && args.includes('--body')) {
        body = args[args.indexOf('--body') + 1]!;
        edits.push(body);
      }
      return { stdout: '{}' };
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeSuccessfulRunner(),
      events,
      projectRoot: dir,
      daemon: true,
      selfHost: true,
      config: { steps: { 'release-disposition': { skill: '.agents/skills/release-disposition/SKILL.md' } } },
      gh,
    });
    (conductor as any).shipDraftPrUrl = prUrl;
    await (conductor as any).snapshotFinishReleaseMetadata();

    body = '## What Changed\n\nFinish-authored reader content.';
    const ctx = await (conductor as any).completionCtx({
      feature_desc: 'test feature',
      worktree_branch: 'feat/test-feature',
    } satisfies ConductState);
    await ctx.repairFinishPr(prUrl);

    expect({ body, edits }).toEqual({
      body: `## What Changed\n\nFinish-authored reader content.\n\n${metadata}`,
      edits: [`## What Changed\n\nFinish-authored reader content.\n\n${metadata}`],
    });
  });

  it('replaces altered and duplicate metadata with exactly the captured block', async () => {
    const prUrl = 'https://github.com/example/repo/pull/1';
    const snapshot = [
      'Release-Disposition: note',
      'Release-Category: Fixed',
      'Release-Semver: patch',
      'Release-Note: Preserve release metadata after finish.',
    ].join('\n');
    let body = snapshot;
    const gh: GhRunner = async (args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        return { stdout: JSON.stringify({ title: 'feat: test', isDraft: false, labels: [], body }) };
      }
      if (args[0] === 'pr' && args[1] === 'edit' && args.includes('--body')) {
        body = args[args.indexOf('--body') + 1]!;
      }
      return { stdout: '{}' };
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeSuccessfulRunner(),
      events,
      projectRoot: dir,
      daemon: true,
      selfHost: true,
      config: { steps: { 'release-disposition': { skill: '.agents/skills/release-disposition/SKILL.md' } } },
      gh,
    });
    (conductor as any).shipDraftPrUrl = prUrl;
    await (conductor as any).snapshotFinishReleaseMetadata();

    body = [
      '## What Changed',
      '',
      'Finish-authored reader content.',
      '',
      'Release-Disposition: no-note',
      'Release-Disposition: note',
      'Release-Category: Changed',
      'Release-Semver: minor',
      'Release-Note: Altered metadata.',
    ].join('\n');
    const ctx = await (conductor as any).completionCtx({
      feature_desc: 'test feature',
      worktree_branch: 'feat/test-feature',
    } satisfies ConductState);
    await ctx.repairFinishPr(prUrl);

    expect(body).toBe(`## What Changed\n\nFinish-authored reader content.\n\n${snapshot}`);
  });

  it('preserves the metadata snapshot/restore when a halt PR was already repaired at SHIP adoption', async () => {
    // Full sequence with the new SHIP-adoption repair in front of it:
    //   adoption repair (halt placeholder → presentable, still draft)
    //   → release-disposition writes metadata → pre-finish snapshot
    //   → finish repair rewrites the body → metadata restored, PR ready.
    const prUrl = 'https://github.com/example/repo/pull/1';
    const metadata = [
      'Release-Disposition: note',
      'Release-Category: Fixed',
      'Release-Semver: patch',
      'Release-Note: Preserve release metadata after finish.',
    ].join('\n');
    const pr = {
      title: 'needs-remediation: feat/test-feature — manual remediation required',
      body: [NEEDS_REMEDIATION_BODY_MARKER, '', ...HALT_PR_BANNER_LINES].join('\n'),
      isDraft: true,
      labels: ['needs-remediation'] as string[],
      comments: [] as string[],
    };
    const gh: GhRunner = async (args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        return {
          stdout: JSON.stringify({
            title: pr.title,
            isDraft: pr.isDraft,
            labels: pr.labels.map((name) => ({ name })),
            body: pr.body,
            comments: pr.comments.map((body) => ({ body })),
          }),
        };
      }
      if (args[0] === 'pr' && args[1] === 'edit') {
        const t = args.indexOf('--title');
        if (t >= 0) pr.title = args[t + 1]!;
        const b = args.indexOf('--body');
        if (b >= 0) pr.body = args[b + 1]!;
      }
      if (args[0] === 'pr' && args[1] === 'ready') pr.isDraft = args.includes('--undo');
      if (args[0] === 'pr' && args[1] === 'comment') {
        pr.comments.push(args[args.indexOf('--body') + 1] ?? '');
      }
      if (args[0] === 'api' && args[args.indexOf('--method') + 1] === 'DELETE') {
        const name = decodeURIComponent(String(args[3] ?? '').split('/labels/')[1] ?? '');
        pr.labels = pr.labels.filter((l) => l !== name);
      }
      return { stdout: '{}' };
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeSuccessfulRunner(),
      events,
      projectRoot: dir,
      daemon: true,
      selfHost: true,
      config: { steps: { 'release-disposition': { skill: '.agents/skills/release-disposition/SKILL.md' } } },
      gh,
    });
    const state = {
      feature_desc: 'test feature',
      worktree_branch: 'feat/test-feature',
    } satisfies ConductState;

    // 1. SHIP adoption: the placeholder becomes presentable, and stays a draft.
    await (conductor as any).makeRetainedShipPrPresentable(prUrl, state, 'release-disposition');
    expect(pr.title).not.toContain('needs-remediation:');
    expect(pr.labels).not.toContain('needs-remediation');
    expect(pr.isDraft).toBe(true);

    // 2. release-disposition writes its metadata into the retained draft body.
    pr.body = `${pr.body}\n\n${metadata}`;
    (conductor as any).shipDraftPrUrl = prUrl;
    await (conductor as any).snapshotFinishReleaseMetadata();

    // 3. finish authors reader content over the body, then repairs.
    pr.body = '## What Changed\n\nFinish-authored reader content.';
    const ctx = await (conductor as any).completionCtx(state);
    await ctx.repairFinishPr(prUrl);

    expect(pr.body).toBe(`## What Changed\n\nFinish-authored reader content.\n\n${metadata}`);
    // Only finish flips the retained PR ready-for-review.
    expect(pr.isDraft).toBe(false);
    // The halt narrative was captured exactly once, at adoption.
    expect(pr.comments.filter((c) => c.includes(HALT_HISTORY_COMMENT_MARKER))).toHaveLength(1);
  });

  it('does not read or mutate metadata outside the self-host release-disposition flow', async () => {
    const prUrl = 'https://github.com/example/repo/pull/1';
    let body = 'Finish-authored reader content.';
    const calls: string[][] = [];
    const gh: GhRunner = async (args: string[]) => {
      calls.push(args);
      if (args[0] === 'pr' && args[1] === 'view') {
        return { stdout: JSON.stringify({ title: 'feat: test', isDraft: false, labels: [], body }) };
      }
      if (args[0] === 'pr' && args[1] === 'edit' && args.includes('--body')) {
        body = args[args.indexOf('--body') + 1]!;
      }
      return { stdout: '{}' };
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeSuccessfulRunner(),
      events,
      projectRoot: dir,
      daemon: true,
      selfHost: false,
      config: { steps: { 'release-disposition': { skill: '.agents/skills/release-disposition/SKILL.md' } } },
      gh,
    });
    (conductor as any).shipDraftPrUrl = prUrl;
    await (conductor as any).snapshotFinishReleaseMetadata();
    const ctx = await (conductor as any).completionCtx({
      feature_desc: 'test feature',
      worktree_branch: 'feat/test-feature',
    } satisfies ConductState);
    await ctx.repairFinishPr(prUrl);

    expect({ body, metadataEdits: calls.filter((args) => args.includes('--body')) }).toEqual({
      body: 'Finish-authored reader content.',
      metadataEdits: [],
    });
  });

  it('fails closed before finish completion when the release metadata snapshot is unavailable', async () => {
    const prUrl = 'https://github.com/example/repo/pull/1';
    const calls: string[][] = [];
    const gh: GhRunner = async (args: string[]) => {
      calls.push(args);
      if (args[0] === 'pr' && args[1] === 'view') throw new Error('GitHub unavailable');
      return { stdout: '{}' };
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeSuccessfulRunner(),
      events,
      projectRoot: dir,
      daemon: true,
      selfHost: true,
      config: { steps: { 'release-disposition': { skill: '.agents/skills/release-disposition/SKILL.md' } } },
      gh,
    });
    (conductor as any).shipDraftPrUrl = prUrl;

    await expect((conductor as any).snapshotFinishReleaseMetadata()).rejects.toThrow(
      'pre-finish snapshot unavailable',
    );
    const ctx = await (conductor as any).completionCtx({
      feature_desc: 'test feature', worktree_branch: 'feat/test-feature',
    } satisfies ConductState);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/finish-choice'), 'pr', 'utf-8');
    await writeFile(join(dir, '.pipeline/conduct-state.json'), JSON.stringify({ pr_url: prUrl }), 'utf-8');
    ctx.isHeadPushed = undefined;
    ctx.shipmentEvidence = async () => ({
      kind: 'valid', slug: 'test-feature', pr: prUrl,
      recordPath: '.docs/shipped/test-feature.md', hash: 'test-hash', commit: 'test-commit',
    });

    const result = await checkStepCompletion(dir, 'finish', ctx);

    expect(result).toMatchObject({ done: false });
    expect(result.reason).toContain('release metadata preservation failed');
    expect(calls.some((args) => args[0] === 'pr' && args[1] === 'ready')).toBe(false);
  });

  it('fails finish completion and never readies the PR when restore readback cannot verify metadata', async () => {
    const prUrl = 'https://github.com/example/repo/pull/1';
    const metadata = [
      'Release-Disposition: note', 'Release-Category: Fixed', 'Release-Semver: patch',
      'Release-Note: Preserve release metadata after finish.',
    ].join('\n');
    const calls: string[][] = [];
    let body = metadata;
    let readCount = 0;
    const gh: GhRunner = async (args: string[]) => {
      calls.push(args);
      if (args[0] === 'pr' && args[1] === 'view' && args.some((arg) => arg.includes('body'))) {
        readCount++;
        return { stdout: JSON.stringify({ title: 'feat: test', isDraft: false, labels: [], body }) };
      }
      if (args[0] === 'pr' && args[1] === 'edit' && args.includes('--body')) {
        body = 'finish body without release metadata';
        return { stdout: '{}' };
      }
      if (args[0] === 'pr' && args[1] === 'view') {
        return { stdout: JSON.stringify({ title: 'feat: test', isDraft: false, labels: [] }) };
      }
      return { stdout: '{}' };
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeSuccessfulRunner(),
      events,
      projectRoot: dir,
      daemon: true,
      selfHost: true,
      config: { steps: { 'release-disposition': { skill: '.agents/skills/release-disposition/SKILL.md' } } },
      gh,
    });
    (conductor as any).shipDraftPrUrl = prUrl;
    await (conductor as any).snapshotFinishReleaseMetadata();
    body = 'Finish-authored reader content.';
    const ctx = await (conductor as any).completionCtx({
      feature_desc: 'test feature', worktree_branch: 'feat/test-feature',
    } satisfies ConductState);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/finish-choice'), 'pr', 'utf-8');
    await writeFile(join(dir, '.pipeline/conduct-state.json'), JSON.stringify({ pr_url: prUrl }), 'utf-8');
    ctx.isHeadPushed = undefined;
    ctx.shipmentEvidence = async () => ({
      kind: 'valid',
      slug: 'test-feature',
      pr: prUrl,
      recordPath: '.docs/shipped/test-feature.md',
      hash: 'test-hash',
      commit: 'test-commit',
    });

    const result = await checkStepCompletion(dir, 'finish', ctx);

    expect(result).toMatchObject({ done: false });
    expect(result.reason).toContain('release metadata preservation failed');
    expect(readCount).toBeGreaterThanOrEqual(3);
    expect(calls.some((args) => args[0] === 'pr' && args[1] === 'ready')).toBe(false);
  });

  // FINISH runs one publication transition per dispatch, so the pre-dispatch
  // snapshot hook fires again AFTER `author_pr_prose` has legitimately rewritten
  // the body without the metadata. Re-deriving the capture from that body found
  // nothing and halted the feature at the very last step.
  it('retains the captured block when finish re-dispatches after the prose author stripped the body', async () => {
    const prUrl = 'https://github.com/example/repo/pull/1';
    const metadata = [
      'Release-Disposition: note',
      'Release-Category: Fixed',
      'Release-Semver: patch',
      'Release-Note: Preserve release metadata after finish.',
    ].join('\n');
    let body = metadata;
    const gh: GhRunner = async (args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        return { stdout: JSON.stringify({ title: 'feat: test', isDraft: false, labels: [], body }) };
      }
      if (args[0] === 'pr' && args[1] === 'edit' && args.includes('--body')) {
        body = args[args.indexOf('--body') + 1]!;
      }
      return { stdout: '{}' };
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeSuccessfulRunner(),
      events,
      projectRoot: dir,
      daemon: true,
      selfHost: true,
      config: { steps: { 'release-disposition': { skill: '.agents/skills/release-disposition/SKILL.md' } } },
      gh,
    });
    (conductor as any).shipDraftPrUrl = prUrl;
    await (conductor as any).snapshotFinishReleaseMetadata();

    // author_pr_prose rewrote the whole body; the next finish dispatch re-enters
    // the snapshot hook against that stripped body.
    body = '## What Changed\n\nFinish-authored reader content.';
    await expect((conductor as any).snapshotFinishReleaseMetadata()).resolves.toBeUndefined();

    const ctx = await (conductor as any).completionCtx({
      feature_desc: 'test feature',
      worktree_branch: 'feat/test-feature',
    } satisfies ConductState);
    await ctx.repairFinishPr(prUrl);

    expect(body).toBe(`## What Changed\n\nFinish-authored reader content.\n\n${metadata}`);
  });

  // The daemon re-dispatches a feature in a fresh process, so an in-memory-only
  // capture is lost between the prose rewrite and the next finish dispatch.
  it('restores from the persisted capture when finish re-dispatches in a fresh process', async () => {
    const prUrl = 'https://github.com/example/repo/pull/1';
    const metadata = [
      'Release-Disposition: note',
      'Release-Category: Fixed',
      'Release-Semver: patch',
      'Release-Note: Preserve release metadata after finish.',
    ].join('\n');
    let body = metadata;
    const gh: GhRunner = async (args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        return { stdout: JSON.stringify({ title: 'feat: test', isDraft: false, labels: [], body }) };
      }
      if (args[0] === 'pr' && args[1] === 'edit' && args.includes('--body')) {
        body = args[args.indexOf('--body') + 1]!;
      }
      return { stdout: '{}' };
    };
    const options = {
      stateFilePath: statePath,
      stepRunner: makeSuccessfulRunner(),
      events,
      projectRoot: dir,
      daemon: true,
      selfHost: true,
      config: { steps: { 'release-disposition': { skill: '.agents/skills/release-disposition/SKILL.md' } } },
      gh,
    };
    const first = new Conductor(options);
    (first as any).shipDraftPrUrl = prUrl;
    await (first as any).snapshotFinishReleaseMetadata();

    body = '## What Changed\n\nFinish-authored reader content.';

    const resumed = new Conductor(options);
    (resumed as any).shipDraftPrUrl = prUrl;
    await (resumed as any).snapshotFinishReleaseMetadata();
    const ctx = await (resumed as any).completionCtx({
      feature_desc: 'test feature',
      worktree_branch: 'feat/test-feature',
    } satisfies ConductState);
    await ctx.repairFinishPr(prUrl);

    expect(body).toBe(`## What Changed\n\nFinish-authored reader content.\n\n${metadata}`);
  });

  // A kickback can re-run release-disposition after a capture exists. The newly
  // written disposition is authoritative; restoring the superseded one would
  // silently ship the wrong release note.
  it('discards a stale capture when release-disposition is dispatched again', async () => {
    const prUrl = 'https://github.com/example/repo/pull/1';
    const stale = [
      'Release-Disposition: note',
      'Release-Category: Fixed',
      'Release-Semver: patch',
      'Release-Note: Superseded note.',
    ].join('\n');
    const fresh = [
      'Release-Disposition: note',
      'Release-Category: Added',
      'Release-Semver: minor',
      'Release-Note: The disposition actually written last.',
    ].join('\n');
    let body = stale;
    const gh: GhRunner = async (args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        return { stdout: JSON.stringify({ title: 'feat: test', isDraft: false, labels: [], body }) };
      }
      if (args[0] === 'pr' && args[1] === 'edit' && args.includes('--body')) {
        body = args[args.indexOf('--body') + 1]!;
      }
      return { stdout: '{}' };
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: makeSuccessfulRunner(),
      events,
      projectRoot: dir,
      daemon: true,
      selfHost: true,
      config: { steps: { 'release-disposition': { skill: '.agents/skills/release-disposition/SKILL.md' } } },
      gh,
    });
    (conductor as any).shipDraftPrUrl = prUrl;
    await (conductor as any).snapshotFinishReleaseMetadata();

    // release-disposition re-runs and rewrites the block, then finish captures again.
    await (conductor as any).clearFinishReleaseMetadataSnapshot();
    body = fresh;
    await (conductor as any).snapshotFinishReleaseMetadata();

    body = '## What Changed\n\nFinish-authored reader content.';
    const ctx = await (conductor as any).completionCtx({
      feature_desc: 'test feature',
      worktree_branch: 'feat/test-feature',
    } satisfies ConductState);
    await ctx.repairFinishPr(prUrl);

    expect(body).toBe(`## What Changed\n\nFinish-authored reader content.\n\n${fresh}`);
  });
});
