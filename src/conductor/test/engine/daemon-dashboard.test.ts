import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  scanInheritedState,
  renderDashboard,
  type InheritedState,
} from '../../src/engine/daemon-dashboard.js';
import type { BacklogItem } from '../../src/engine/daemon.js';
import type { ComplexityTier } from '../../src/types/index.js';
import type { PriorityResolution } from '../../src/engine/backlog-priority.js';
import type { GatedItem } from '../../src/engine/daemon-backlog.js';
import { isOperatorParked, writeOperatorPark } from '../../src/engine/park-marker.js';

function item(slug: string, tier?: ComplexityTier): BacklogItem {
  return tier ? { slug, tier } : { slug };
}

describe('engine/daemon-dashboard — scanInheritedState (FR-2/FR-3)', () => {
  let root: string;
  let worktreeBase: string;
  let processedDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dashboard-'));
    worktreeBase = join(root, '.worktrees');
    processedDir = join(root, '.daemon/processed');
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function makeHalted(slug: string, reason: string): Promise<void> {
    const p = join(worktreeBase, slug, '.pipeline');
    await mkdir(p, { recursive: true });
    await writeFile(join(p, 'HALT'), reason, 'utf-8');
  }
  async function makeStateful(slug: string, state: unknown): Promise<void> {
    const p = join(worktreeBase, slug, '.pipeline');
    await mkdir(p, { recursive: true });
    await writeFile(
      join(p, 'conduct-state.json'),
      typeof state === 'string' ? state : JSON.stringify(state),
      'utf-8',
    );
  }
  async function makeLifecycleEvent(
    slug: string,
    step: string,
    lifecycle: Record<string, unknown>,
  ): Promise<void> {
    const p = join(worktreeBase, slug, '.pipeline');
    await mkdir(p, { recursive: true });
    await writeFile(
      join(p, 'events.jsonl'),
      `${JSON.stringify({
        type: 'provider_attempt',
        step,
        provider: 'provider-lifecycle',
        outcome: 'success',
        invoked: false,
        lifecycle,
      })}\n`,
      'utf-8',
    );
  }
  // Legacy ledger format (plain `shipped`).
  async function makeProcessed(slug: string): Promise<void> {
    await mkdir(processedDir, { recursive: true });
    await writeFile(join(processedDir, slug), 'shipped\n', 'utf-8');
  }
  // New ledger format (JSON with a PR url).
  async function makeProcessedJson(slug: string, prUrl?: string): Promise<void> {
    await mkdir(processedDir, { recursive: true });
    await writeFile(
      join(processedDir, slug),
      `${JSON.stringify({ status: 'shipped', prUrl: prUrl ?? null })}\n`,
      'utf-8',
    );
  }

  it('classifies halted (reason = first line), in-progress (last step), eligible, processed count', async () => {
    await makeHalted('h1', 'rebase conflict — parked\nConflicted files: src/a.ts');
    await makeHalted('h2', 'prd-audit gap');
    await makeStateful('ip1', { build: 'in_progress', acceptance_specs: 'done' });
    for (const s of ['p1', 'p2', 'p3']) await makeProcessed(s);

    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [item('e1'), item('e2')],
    });

    expect(state.halted.map((h) => h.slug).sort()).toEqual(['h1', 'h2']);
    expect(state.halted.find((h) => h.slug === 'h1')?.reason).toBe(
      'rebase conflict — parked',
    );
    expect(state.inProgress).toEqual([{ slug: 'ip1', step: 'build' }]);
    expect(state.eligible.map((e) => e.slug).sort()).toEqual(['e1', 'e2']);
    expect(state.processedCount).toBe(3);
  });

  it('populates heartbeatAgeMs for an IN-PROGRESS worktree with a step-heartbeat file', async () => {
    await makeStateful('ip1', { build: 'in_progress' });
    const heartbeatTs = new Date(Date.now() - 45_000).toISOString();
    await writeFile(
      join(worktreeBase, 'ip1', '.pipeline', 'step-heartbeat'),
      JSON.stringify({ step: 'build', ts: heartbeatTs }),
      'utf-8',
    );

    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [],
    });

    const entry = state.inProgress.find((p) => p.slug === 'ip1');
    expect(entry?.heartbeatAgeMs).toBeGreaterThanOrEqual(45_000);
    expect(entry?.heartbeatAgeMs).toBeLessThan(50_000);
  });

  it('leaves heartbeatAgeMs undefined when the heartbeat belongs to an earlier step', async () => {
    // The heartbeat file is overwritten, never cleared: a feature now running
    // architecture_review_as_built still carries its last `build` pulse. Its
    // age says nothing about the step in flight and must not be rendered.
    await makeStateful('ip1', { architecture_review_as_built: 'in_progress' });
    await writeFile(
      join(worktreeBase, 'ip1', '.pipeline', 'step-heartbeat'),
      JSON.stringify({ step: 'build', ts: new Date(Date.now() - 214 * 60_000).toISOString() }),
      'utf-8',
    );

    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [],
    });

    const entry = state.inProgress.find((p) => p.slug === 'ip1');
    expect(entry?.step).toBe('architecture_review_as_built');
    expect(entry?.heartbeatAgeMs).toBeUndefined();
  });

  it('leaves heartbeatAgeMs undefined when no step-heartbeat file exists (not "0s ago")', async () => {
    await makeStateful('ip1', { build: 'in_progress' });

    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [],
    });

    const entry = state.inProgress.find((p) => p.slug === 'ip1');
    expect(entry?.heartbeatAgeMs).toBeUndefined();
  });

  it('reads the current lifecycle phase and attempt evidence for an in-progress feature', async () => {
    await makeStateful('preparing', { build: 'in_progress' });
    await makeStateful('running', { build: 'in_progress' });
    await makeStateful('recovering', { build: 'in_progress' });
    await makeLifecycleEvent('preparing', 'build', {
      phase: 'preparing', attemptId: 'attempt-1', recoveryCount: 0,
    });
    await makeLifecycleEvent('running', 'build', {
      phase: 'running', attemptId: 'attempt-2', recoveryCount: 0,
    });
    await makeLifecycleEvent('recovering', 'build', {
      phase: 'recovering', attemptId: 'attempt-3', recoveryCount: 1, reason: 'preparation-timeout',
    });

    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [],
    });

    expect(state.inProgress).toMatchObject([
      { slug: 'preparing', lifecycle: { phase: 'preparing', attemptId: 'attempt-1', recoveryCount: 0 } },
      { slug: 'recovering', lifecycle: { phase: 'recovering', attemptId: 'attempt-3', recoveryCount: 1, reason: 'preparation-timeout' } },
      { slug: 'running', lifecycle: { phase: 'running', attemptId: 'attempt-2', recoveryCount: 0 } },
    ]);
  });

  it('reads exhausted lifecycle evidence for a halted feature', async () => {
    await makeHalted('halted', 'Provider preparation exhausted.');
    await makeStateful('halted', { build: 'in_progress' });
    await makeLifecycleEvent('halted', 'build', {
      phase: 'exhausted',
      attemptId: 'attempt-4',
      recoveryCount: 1,
      reason: 'preparation-timeout-exhausted',
    });

    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [],
    });

    expect(state.halted).toMatchObject([
      {
        slug: 'halted',
        lifecycle: {
          phase: 'halted',
          attemptId: 'attempt-4',
          recoveryCount: 1,
          reason: 'preparation-timeout-exhausted',
        },
      },
    ]);
  });

  it('falls back cleanly when lifecycle evidence is missing or malformed', async () => {
    await makeStateful('missing', { build: 'in_progress' });
    await makeStateful('malformed', { build: 'in_progress' });
    await makeStateful('settled', { build: 'in_progress' });
    const pipeline = join(worktreeBase, 'malformed', '.pipeline');
    await writeFile(
      join(pipeline, 'events.jsonl'),
      '{ not json }\n' + JSON.stringify({
        type: 'provider_attempt', step: 'build',
        lifecycle: { phase: 'recovering', attemptId: 'invalid-attempt', recoveryCount: 0 },
      }) + '\n',
      'utf-8',
    );
    const settledPipeline = join(worktreeBase, 'settled', '.pipeline');
    await writeFile(
      join(settledPipeline, 'events.jsonl'),
      [
        { type: 'provider_attempt', step: 'build', lifecycle: { phase: 'running', attemptId: 'attempt-5', recoveryCount: 0 } },
        { type: 'provider_attempt', step: 'build', lifecycle: { phase: 'settled', attemptId: 'attempt-5', recoveryCount: 0, outcome: 'completed' } },
      ].map((event) => JSON.stringify(event)).join('\n') + '\n',
      'utf-8',
    );

    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [],
    });

    expect(state.inProgress).toEqual([
      { slug: 'malformed', step: 'build' },
      { slug: 'missing', step: 'build' },
      { slug: 'settled', step: 'build' },
    ]);
  });

  it('enriches halted/in-progress with step, tier, and PR url from conduct-state', async () => {
    await makeHalted('h', 'prd-audit gap');
    await makeStateful('h', {
      complexity_tier: 'L',
      prd_audit: 'in_progress',
      finish: 'done',
      pr_url: 'https://github.com/o/r/pull/7',
    });
    await makeStateful('ip', {
      complexity_tier: 'M',
      build: 'in_progress',
      pr_url: 'https://github.com/o/r/pull/8',
    });

    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [],
    });

    const h = state.halted.find((e) => e.slug === 'h');
    expect(h).toMatchObject({
      slug: 'h',
      reason: 'prd-audit gap',
      step: 'prd_audit',
      tier: 'L',
      prUrl: 'https://github.com/o/r/pull/7',
    });
    expect(state.inProgress).toEqual([
      {
        slug: 'ip',
        step: 'build',
        tier: 'M',
        prUrl: 'https://github.com/o/r/pull/8',
      },
    ]);
  });

  it('a slug both processed and gated appears only in PROCESSED (pinned precedence)', async () => {
    await makeProcessed('dup');
    const gatedDup: GatedItem = {
      kind: 'spec',
      slug: 'dup',
      reason: 'other-owner',
      otherOwner: 'someone',
      remedy: 'ping them',
    };
    const gatedOnly: GatedItem = {
      kind: 'spec',
      slug: 'only-gated',
      // 'other-owner' is the only reason GatedSpecItem produces today;
      // un-owned specs always default-build, so 'unowned-post-cutover' is no
      // longer a real gate reason (see GatedSpecItem's doc comment).
      reason: 'other-owner',
      remedy: 'claim it',
    };

    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => ({ items: [], waiting: [], gated: [gatedDup, gatedOnly] }),
    });

    expect(state.processed.map((p) => p.slug)).toEqual(['dup']);
    expect((state.gated ?? []).some((g) => g.kind === 'spec' && g.slug === 'dup')).toBe(false);
    expect((state.gated ?? []).some((g) => g.kind === 'spec' && g.slug === 'only-gated')).toBe(
      true,
    );
  });

  it('eligible carries the backlog tier; processed carries the persisted PR url', async () => {
    await makeProcessedJson('shipped-pr', 'https://github.com/o/r/pull/3');
    await makeProcessed('shipped-legacy'); // legacy plain-text ledger → no PR

    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [item('big', 'L'), item('small', 'S')],
    });

    expect(state.eligible.sort((a, b) => a.slug.localeCompare(b.slug))).toEqual([
      { slug: 'big', tier: 'L' },
      { slug: 'small', tier: 'S' },
    ]);
    expect(state.processedCount).toBe(2);
    expect(state.processed.find((p) => p.slug === 'shipped-pr')?.prUrl).toBe(
      'https://github.com/o/r/pull/3',
    );
    expect(
      state.processed.find((p) => p.slug === 'shipped-legacy')?.prUrl,
    ).toBeUndefined();
  });

  it('PROCESSED wins over IN-PROGRESS (a processed+stateful worktree is not in-progress)', async () => {
    await makeStateful('both', { build: 'done' });
    await makeProcessed('both');
    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [],
    });
    expect(state.inProgress).toEqual([]);
    expect(state.processedCount).toBe(1);
  });

  it('HALTED wins over IN-PROGRESS (worktree with both HALT and conduct-state)', async () => {
    await makeHalted('x', 'needs human');
    await makeStateful('x', { build: 'in_progress' });
    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [],
    });
    expect(state.halted.map((h) => h.slug)).toEqual(['x']);
    expect(state.inProgress).toEqual([]);
  });

  it('excludes a halted/processed slug from ELIGIBLE', async () => {
    await makeHalted('h', 'parked');
    await makeProcessed('done1');
    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [item('h'), item('done1'), item('fresh')],
    });
    expect(state.eligible.map((e) => e.slug)).toEqual(['fresh']);
  });

  it('empty HALT → reason unknown', async () => {
    await makeHalted('empty', '');
    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [],
    });
    expect(state.halted).toEqual([{ slug: 'empty', reason: 'unknown' }]);
  });

  it('malformed conduct-state → step unknown, still IN-PROGRESS', async () => {
    await makeStateful('bad', '{ not json ');
    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [],
    });
    expect(state.inProgress).toEqual([{ slug: 'bad', step: 'unknown' }]);
    expect(state.neverStarted).toEqual([]);
    expect(state.retainedWorktrees).toEqual([]);
  });

  it('missing .worktrees/ → zero worktrees (no throw)', async () => {
    const state = await scanInheritedState({
      worktreeBase, // never created
      processedDir,
      discover: async () => [],
    });
    expect(state.halted).toEqual([]);
    expect(state.inProgress).toEqual([]);
    expect(state.processedCount).toBe(0);
  });

  it('a per-worktree fs error is skipped, not thrown, and other groups render', async () => {
    await makeStateful('ok', { build: 'in_progress' });
    // A worktree dir whose .pipeline is a FILE, not a dir → reads inside throw.
    const broken = join(worktreeBase, 'broken');
    await mkdir(broken, { recursive: true });
    await writeFile(join(broken, '.pipeline'), 'x', 'utf-8');
    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [],
    });
    expect(state.inProgress.map((p) => p.slug)).toContain('ok');
    // `broken` is not a HALT and its state read fails → simply absent.
    expect(state.halted).toEqual([]);
  });

  it('excludes infrastructure worktrees from never-started while containing a state-read failure', async () => {
    await mkdir(join(worktreeBase, 'engineer-bootstrap'), { recursive: true });
    await mkdir(join(worktreeBase, 'resolve-conflict'), { recursive: true });
    await mkdir(join(worktreeBase, 'never-started', '.pipeline'), { recursive: true });
    await makeStateful('active', { build: 'in_progress' });

    // A file where `.pipeline/` should be makes the state-file read reject.
    const unreadable = join(worktreeBase, 'unreadable');
    await mkdir(unreadable, { recursive: true });
    await writeFile(join(unreadable, '.pipeline'), 'not a directory', 'utf-8');

    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [],
    });

    expect(state.neverStarted).toEqual(['never-started', 'unreadable']);
    expect(state.retainedWorktrees).toEqual([]);
    expect(state.inProgress).toEqual([{ slug: 'active', step: 'build' }]);
  });

  it('backlog discovery failure degrades eligible to [] without throwing', async () => {
    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => {
        throw new Error('offline');
      },
    });
    expect(state.eligible).toEqual([]);
  });

  it('classifies a worktree without state, HALT, or ledger entry as never-started', async () => {
    await mkdir(join(worktreeBase, 'never-started', '.pipeline'), { recursive: true });

    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [],
    });

    expect(state).toMatchObject({
      neverStarted: ['never-started'],
      retainedWorktrees: [],
    });
  });

  it('renders a never-started eligible slug in ELIGIBLE', async () => {
    await mkdir(join(worktreeBase, 'never-started', '.pipeline'), { recursive: true });

    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [item('never-started')],
    });
    const out = renderDashboard(state);
    const eligibleSection = out.slice(out.indexOf('ELIGIBLE'), out.indexOf('PROCESSED'));

    expect(state.retainedWorktrees).toEqual([]);
    expect(eligibleSection).toContain('• never-started');
  });

  it('renders an operator-parked never-started worktree under PARKED, not ELIGIBLE', async () => {
    const slug = 'never-started-parked';
    await mkdir(join(worktreeBase, slug, '.pipeline'), { recursive: true });
    await writeOperatorPark(root, slug);

    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [item(slug)],
    });
    const out = renderDashboard({
      ...state,
      parked: (await isOperatorParked(root, slug)) ? [slug] : [],
    });
    const eligibleSection = out.slice(out.indexOf('ELIGIBLE'));

    expect(out).toContain('PARKED (1)\n  • never-started-parked');
    expect(eligibleSection).not.toContain(slug);
  });

  it('renders a halted never-started worktree under HALTED, not ELIGIBLE', async () => {
    const slug = 'never-started-halted';
    await makeHalted(slug, 'needs operator');

    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [item(slug)],
    });
    const out = renderDashboard(state);
    const eligibleSection = out.slice(out.indexOf('ELIGIBLE'));

    expect(out).toContain('HALTED (1)\n  • never-started-halted — needs operator');
    expect(eligibleSection).not.toContain(slug);
  });

  it('classifies setup-era-only pipeline artifacts as never-started', async () => {
    const pipeline = join(worktreeBase, 'setup-only', '.pipeline');
    await mkdir(join(pipeline, 'git-hooks'), { recursive: true });
    await mkdir(join(pipeline, 'session-hooks'), { recursive: true });
    await mkdir(join(pipeline, 'audit-trail'), { recursive: true });
    await writeFile(join(pipeline, 'step-heartbeat'), '{}\n', 'utf-8');
    await writeFile(join(pipeline, 'task-evidence.json'), '{}\n', 'utf-8');
    await writeFile(join(pipeline, 'events.jsonl'), '', 'utf-8');

    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [],
    });

    expect(state.neverStarted).toEqual(['setup-only']);
    expect(state.retainedWorktrees).toEqual([]);
  });

  it('renders retained worktrees from disk even when absent from the watch registry', async () => {
    await mkdir(join(worktreeBase, 'capped-out'), { recursive: true });
    await mkdir(join(worktreeBase, 'resolve-capped-out'), { recursive: true });
    await mkdir(join(worktreeBase, 'engineer-capped-out'), { recursive: true });
    await makeProcessed('capped-out');

    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [],
    });
    const out = renderDashboard(state);

    expect(
      out
        .split('\n')
        .filter((line) => line.startsWith('RETAINED WORKTREES') || line.startsWith('  • ')),
    ).toEqual(['RETAINED WORKTREES (1)', '  • capped-out — shipped-no-pr-reference']);
  });

  it('derives shipped-no-pr-reference for a legacy shipped ledger entry', async () => {
    await mkdir(join(worktreeBase, 'legacy-shipped'), { recursive: true });
    await makeProcessed('legacy-shipped');

    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [],
    });

    expect(state.retainedWorktrees).toEqual([
      { slug: 'legacy-shipped', reason: 'shipped-no-pr-reference' },
    ]);
    expect(state.retainedWorktrees?.some((entry) => entry.reason === 'pr-open-awaiting-main')).toBe(false);
  });

  it('renders a shipped ledger PR URL as unknown when no PR-state probe is injected', async () => {
    const prUrl = 'https://github.com/example/repo/pull/41';
    await mkdir(join(worktreeBase, 'unknown-pr-state'), { recursive: true });
    await makeProcessedJson('unknown-pr-state', prUrl);

    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [],
    });

    expect(state.retainedWorktrees).toEqual([
      { slug: 'unknown-pr-state', reason: 'pr-state-unknown', prUrl },
    ]);
    expect(state.retainedWorktrees?.some((entry) => entry.reason === 'pr-open-awaiting-main')).toBe(false);
  });

  it('refines shipped ledger rows from an injected PR-state probe', async () => {
    const openPrUrl = 'https://github.com/example/repo/pull/41';
    const closedPrUrl = 'https://github.com/example/repo/pull/42';
    await mkdir(join(worktreeBase, 'awaiting-main'), { recursive: true });
    await mkdir(join(worktreeBase, 'closed-unmerged'), { recursive: true });
    await makeProcessedJson('awaiting-main', openPrUrl);
    await makeProcessedJson('closed-unmerged', closedPrUrl);

    const state = await scanInheritedState({
      worktreeBase,
      processedDir,
      discover: async () => [],
      prStateProbe: async (prUrl) => (prUrl === openPrUrl ? 'open' : 'closed'),
    });

    expect(state.retainedWorktrees).toEqual([
      { slug: 'awaiting-main', reason: 'pr-open-awaiting-main', prUrl: openPrUrl },
      { slug: 'closed-unmerged', reason: 'pr-closed-unmerged', prUrl: closedPrUrl },
    ]);
    expect(renderDashboard(state)).toContain(
      `awaiting-main — pr-open-awaiting-main  → ${openPrUrl}`,
    );
  });
});

describe('engine/daemon-dashboard — renderDashboard (FR-1/FR-2)', () => {
  it('renders orphan and merged-ready PARKED annotations while unannotated entries keep their line', () => {
    const out = renderDashboard({
      halted: [{ slug: 'orphaned', reason: 'would otherwise halt' }],
      inProgress: [],
      eligible: [{ slug: 'merged' }],
      processed: [],
      processedCount: 0,
      parked: [
        { slug: 'orphaned', annotation: 'orphan' },
        { slug: 'merged', annotation: 'merged-ready' },
        { slug: 'plain' },
      ],
    });

    expect(out).toContain(
      'PARKED (3)\n  • merged — merged — ready to reconcile\n  • orphaned — orphan — needs manual review\n  • plain',
    );
    expect(out).toContain('HALTED (0)');
    expect(out).toContain('ELIGIBLE (0)');
  });

  it('renders four groups with counts and enriched member lines', () => {
    const state: InheritedState = {
      halted: [
        {
          slug: 'h1',
          reason: 'rebase conflict',
          step: 'prd_audit',
          tier: 'L',
          prUrl: 'https://github.com/o/r/pull/7',
        },
      ],
      inProgress: [{ slug: 'ip1', step: 'build', tier: 'M' }],
      eligible: [{ slug: 'e1', tier: 'S' }, { slug: 'e2' }],
      processed: [
        { slug: 'p1', prUrl: 'https://github.com/o/r/pull/3' },
        { slug: 'p2' },
      ],
      processedCount: 2,
    };
    const out = renderDashboard(state, { includeCompleted: true });
    expect(out).toContain('HALTED (1)');
    expect(out).toContain(
      'h1 [L] @prd_audit — rebase conflict  → https://github.com/o/r/pull/7',
    );
    expect(out).toContain('IN-PROGRESS (1)');
    expect(out).toContain('ip1 [M] @build');
    expect(out).toContain('ELIGIBLE (2)');
    expect(out).toContain('e1 [S]');
    expect(out).toContain('e2');
    expect(out).toContain('PROCESSED (2)');
    expect(out).toContain('p1  → https://github.com/o/r/pull/3');
    expect(out).toContain('p2');
  });

  it('renders lifecycle diagnostics and labels heartbeat age as activity telemetry', () => {
    const state: InheritedState = {
      halted: [{
        slug: 'halted',
        reason: 'Provider preparation exhausted.',
        lifecycle: {
          phase: 'halted', attemptId: 'attempt-4', recoveryCount: 1,
          reason: 'preparation-timeout-exhausted',
        },
      }],
      inProgress: [
        {
          slug: 'preparing', step: 'build', heartbeatAgeMs: 45_000,
          lifecycle: { phase: 'preparing', attemptId: 'attempt-1', recoveryCount: 0 },
        },
        {
          slug: 'running', step: 'build',
          lifecycle: { phase: 'running', attemptId: 'attempt-2', recoveryCount: 0 },
        },
        {
          slug: 'recovering', step: 'build',
          lifecycle: {
            phase: 'recovering', attemptId: 'attempt-3', recoveryCount: 1,
            reason: 'preparation-timeout',
          },
        },
      ],
      eligible: [],
      processed: [],
      processedCount: 0,
    };
    const out = renderDashboard(state);
    expect(out).toContain('halted — Provider preparation exhausted. (provider halted: attempt attempt-4, recovery 1 — preparation-timeout-exhausted)');
    expect(out).toContain('preparing @build (provider preparing: attempt attempt-1, recovery 0) (activity telemetry: 45s ago)');
    expect(out).toContain('running @build (provider running: attempt attempt-2, recovery 0)');
    expect(out).toContain('recovering @build (provider recovering: attempt attempt-3, recovery 1 — preparation-timeout)');
  });

  it('renders no heartbeat annotation when heartbeatAgeMs is absent (no heartbeat yet)', () => {
    const state: InheritedState = {
      halted: [],
      inProgress: [{ slug: 'ip1', step: 'build' }],
      eligible: [],
      processed: [],
      processedCount: 0,
    };
    const out = renderDashboard(state);
    expect(out).toContain('ip1 @build');
    expect(out).not.toContain('heartbeat');
  });

  it('zero-state renders all four groups at 0', () => {
    const out = renderDashboard(
      {
        halted: [],
        inProgress: [],
        eligible: [],
        processed: [],
        processedCount: 0,
      },
      { includeCompleted: true },
    );
    expect(out).toContain('HALTED (0)');
    expect(out).toContain('IN-PROGRESS (0)');
    expect(out).toContain('ELIGIBLE (0)');
    expect(out).toContain('PROCESSED (0)');
  });
});

describe('engine/daemon-dashboard — renderDashboard includeCompleted option', () => {
  const state: InheritedState = {
    halted: [],
    inProgress: [],
    eligible: [],
    processed: [{ slug: 'p1' }],
    processedCount: 1,
  };

  it('default call (no opts) omits the PROCESSED group', () => {
    const out = renderDashboard(state);
    expect(out).not.toContain('PROCESSED');
  });

  it('opts.includeCompleted: true includes the PROCESSED group', () => {
    const out = renderDashboard(state, { includeCompleted: true });
    expect(out).toContain('PROCESSED (1)');
    expect(out).toContain('p1');
  });
});

describe('engine/daemon-dashboard — renderDashboard WAITING group (FR-6)', () => {
  it('renders a WAITING section with slug + blocker refs for a blocked verdict', () => {
    const state: InheritedState = {
      halted: [],
      inProgress: [],
      eligible: [{ slug: 'e1' }],
      processed: [],
      processedCount: 0,
      waiting: [
        {
          slug: 'foo',
          verdict: {
            kind: 'blocked',
            blockers: [
              { repo: 'o/r', number: '10' },
              { repo: 'o/r', number: '11' },
            ],
          },
        },
      ],
    };
    const out = renderDashboard(state);
    expect(out).toContain('WAITING (1)');
    expect(out).toContain('foo');
    expect(out).toContain('o/r#10');
    expect(out).toContain('o/r#11');
  });

  it('renders cycle members and indeterminate reason for other verdict kinds', () => {
    const state: InheritedState = {
      halted: [],
      inProgress: [],
      eligible: [],
      processed: [],
      processedCount: 0,
      waiting: [
        {
          slug: 'cyc',
          verdict: { kind: 'cycle', members: [{ repo: 'o/r', number: '1' }] },
        },
        {
          slug: 'ind',
          verdict: { kind: 'indeterminate', detail: 'gh unreachable' },
        },
      ],
    };
    const out = renderDashboard(state);
    expect(out).toContain('WAITING (2)');
    expect(out).toContain('cyc');
    expect(out).toContain('o/r#1');
    expect(out).toContain('ind');
    expect(out).toContain('gh unreachable');
  });

  it('empty waiting list → no WAITING section rendered', () => {
    const out = renderDashboard({
      halted: [],
      inProgress: [],
      eligible: [],
      processed: [],
      processedCount: 0,
      waiting: [],
    });
    expect(out).not.toContain('WAITING');
  });

  it('a missing waiting field renders no WAITING section', () => {
    const out = renderDashboard({
      halted: [],
      inProgress: [],
      eligible: [],
      processed: [],
      processedCount: 0,
    });
    expect(out).not.toContain('WAITING');
  });

  it('same slug present in both eligible items and waiting appears only in WAITING', () => {
    const state: InheritedState = {
      halted: [],
      inProgress: [],
      eligible: [{ slug: 'dup' }],
      processed: [],
      processedCount: 0,
      waiting: [{ slug: 'dup', verdict: { kind: 'indeterminate', detail: 'x' } }],
    };
    const out = renderDashboard(state);
    // ELIGIBLE section should not list dup as an eligible bullet.
    const eligibleSectionStart = out.indexOf('ELIGIBLE');
    const nextSectionStart = out.indexOf('PROCESSED');
    const eligibleSection = out.slice(eligibleSectionStart, nextSectionStart);
    expect(eligibleSection).not.toContain('• dup');
    expect(out).toContain('WAITING (1)');
  });
});

describe('engine/daemon-dashboard — renderDashboard GATED group (FR-7/FR-11, Task 9)', () => {
  it('renders a populated GATED section with slug, reason, and remedy; names the owner for other-owner', () => {
    const state: InheritedState = {
      halted: [],
      inProgress: [],
      eligible: [],
      processed: [],
      processedCount: 0,
      gated: [
        {
          kind: 'spec',
          slug: 'owned-elsewhere',
          reason: 'other-owner',
          otherOwner: 'alice',
          remedy: 'ask alice to release it',
        },
        {
          kind: 'spec',
          slug: 'stale-claim',
          // 'other-owner' is the only reason GatedSpecItem produces today
          // (see GatedSpecItem's doc comment); this second entry — with no
          // `otherOwner` — exercises the "owner unknown" render branch.
          reason: 'other-owner',
          remedy: 'claim it via daemon identity config',
        },
      ],
    };
    const out = renderDashboard(state);
    expect(out).toContain('GATED (2)');
    expect(out).toContain('owned-elsewhere');
    expect(out).toContain('other-owner');
    expect(out).toContain('alice');
    expect(out).toContain('ask alice to release it');
    expect(out).toContain('stale-claim');
    expect(out).toContain('claim it via daemon identity config');
    // No `otherOwner` on this entry → no "(owner: ...)" suffix on its line.
    expect(out).toContain('stale-claim — other-owner — claim it via daemon identity config');
  });

  it('renders repo-kind gated entries as section-level warning lines', () => {
    const state: InheritedState = {
      halted: [],
      inProgress: [],
      eligible: [],
      processed: [],
      processedCount: 0,
      gated: [
        // `GatedRepoItem.warning` only ever carries 'identity-unresolved'
        // today ('no-cutover' is observability-only and never constructed as
        // an item — see GatedItem's doc comment), but renderDashboard's
        // gatedRepoLine keeps a defensive branch for it. Deliberately
        // construct the out-of-domain value via `unknown` to exercise that
        // still-live defensive rendering path.
        {
          kind: 'repo',
          warning: 'no-cutover',
          remedy: 'configure a grandfather cutover date',
        } as unknown as GatedItem,
      ],
    };
    const out = renderDashboard(state);
    expect(out).toContain('GATED (1)');
    expect(out.toLowerCase()).toContain('un-owned');
    expect(out).toContain('configure a grandfather cutover date');
  });

  it('empty gated list → an explicit GATED (0) header is still rendered (never a silently missing section)', () => {
    const out = renderDashboard({
      halted: [],
      inProgress: [],
      eligible: [],
      processed: [],
      processedCount: 0,
      gated: [],
    });
    expect(out).toContain('GATED (0)');
  });

  it('a missing gated field renders no GATED section (discovery-failure fallback, mirrors ELIGIBLE)', () => {
    const out = renderDashboard({
      halted: [],
      inProgress: [],
      eligible: [],
      processed: [],
      processedCount: 0,
    });
    expect(out).not.toContain('GATED');
  });

  it('a gated spec slug is excluded from ELIGIBLE and WAITING (GATED outranks both)', () => {
    const state: InheritedState = {
      halted: [],
      inProgress: [],
      eligible: [{ slug: 'dup' }],
      processed: [],
      processedCount: 0,
      waiting: [{ slug: 'other', verdict: { kind: 'indeterminate', detail: 'x' } }],
      gated: [
        { kind: 'spec', slug: 'dup', reason: 'other-owner', otherOwner: 'bob', remedy: 'ask bob' },
      ],
    };
    const out = renderDashboard(state);
    const eligibleSectionStart = out.indexOf('ELIGIBLE');
    const processedSectionStart = out.indexOf('PROCESSED');
    const eligibleSection = out.slice(eligibleSectionStart, processedSectionStart);
    expect(eligibleSection).not.toContain('• dup');
    expect(out).toContain('GATED (1)');
  });
});

describe('engine/daemon-dashboard — exactly-one-bucket invariant (Task 10, S2 Done When 2)', () => {
  it('a slug present in every bucket type appears exactly once across the whole render', () => {
    const state: InheritedState = {
      halted: [{ slug: 'halted-slug', reason: 'boom' }],
      inProgress: [{ slug: 'inprog-slug', step: 'build' }],
      eligible: [{ slug: 'eligible-slug' }],
      processed: [{ slug: 'processed-slug' }],
      processedCount: 1,
      waiting: [{ slug: 'waiting-slug', verdict: { kind: 'indeterminate', detail: 'x' } }],
      gated: [
        {
          kind: 'spec',
          slug: 'gated-slug',
          reason: 'other-owner',
          otherOwner: 'alice',
          remedy: 'ask alice',
        },
      ],
    };
    const out = renderDashboard(state, { includeCompleted: true });

    const slugs = [
      'halted-slug',
      'inprog-slug',
      'waiting-slug',
      'gated-slug',
      'eligible-slug',
      'processed-slug',
    ];
    for (const slug of slugs) {
      const occurrences = out.split(slug).length - 1;
      expect(occurrences).toBe(1);
    }
  });
});

describe('engine/daemon-dashboard — status output parity (FR-6, Task 17)', () => {
  // daemon-cli's status path (renderStartupDashboard) and any future status
  // summary caller MUST drive scanInheritedState + renderDashboard directly —
  // there is no separate status-only builder to keep in sync. This test pins
  // that architectural fact down: two independent callers, each doing exactly
  // what the plan calls "the status path" and "the dashboard path", must
  // produce byte-identical WAITING output because they share one group builder.
  it('scanInheritedState + renderDashboard produce identical WAITING output across two independent call sites', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dashboard-status-'));
    try {
      const waitingEntry = {
        slug: 'blocked-spec',
        verdict: { kind: 'blocked' as const, blockers: [{ repo: 'acme/app', number: '10' }] },
      };
      const discover = async () => ({ items: [], waiting: [waitingEntry] });

      // "dashboard" call site
      const dashboardState = await scanInheritedState({
        worktreeBase: join(root, '.worktrees'),
        processedDir: join(root, '.daemon/processed'),
        discover: discover as any,
      });
      const dashboardOutput = renderDashboard(dashboardState);

      // "status" call site — same builder, independently invoked, as daemon-cli's
      // renderStartupDashboard does.
      const statusState = await scanInheritedState({
        worktreeBase: join(root, '.worktrees'),
        processedDir: join(root, '.daemon/processed'),
        discover: discover as any,
      });
      const statusOutput = renderDashboard(statusState);

      expect(statusOutput).toEqual(dashboardOutput);
      expect(statusOutput).toContain('WAITING (1)');
      expect(statusOutput).toContain('blocked-spec');
      expect(statusOutput).toContain('acme/app#10');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('engine/daemon-dashboard — ACTIVE groups unaffected by includeCompleted (Task 4 regression)', () => {
  // Fixed representative state exercising every non-PROCESSED group. Proves the
  // includeCompleted gating (Task 1) touches ONLY the PROCESSED section — every
  // other group renders byte-identically whether opts is omitted, false, or true.
  const representativeState: InheritedState = {
    halted: [
      {
        slug: 'h1',
        reason: 'rebase conflict',
        step: 'prd_audit',
        tier: 'L',
        prUrl: 'https://github.com/o/r/pull/7',
      },
    ],
    inProgress: [{ slug: 'ip1', step: 'build', tier: 'M' }],
    eligible: [{ slug: 'e1', tier: 'S' }, { slug: 'e2' }],
    processed: [
      { slug: 'p1', prUrl: 'https://github.com/o/r/pull/3' },
      { slug: 'p2' },
    ],
    processedCount: 2,
    waiting: [
      {
        slug: 'w1',
        verdict: { kind: 'blocked', blockers: [{ repo: 'o/r', number: '10' }] },
      },
    ],
    gated: [
      {
        kind: 'spec',
        slug: 'g1',
        reason: 'other-owner',
        otherOwner: 'alice',
        remedy: 'ask alice',
      },
    ],
    parked: [{ slug: 'pk1', provenance: 'operator', reason: 'manual' }],
  };

  /** Strip the PROCESSED section (header + member lines) out of a rendered dashboard. */
  function withoutProcessedSection(out: string): string {
    return out
      .split('\n')
      .filter((line) => !line.startsWith('PROCESSED') && !/^ {2}• p[12]\b/.test(line))
      .join('\n');
  }

  it('active groups (PARKED/HALTED/IN-PROGRESS/GATED/WAITING/ELIGIBLE) are byte-identical with opts omitted vs. { includeCompleted: true }', () => {
    const withoutOpts = renderDashboard(representativeState);
    const withOpts = renderDashboard(representativeState, { includeCompleted: true });
    expect(withoutProcessedSection(withoutOpts)).toEqual(withoutProcessedSection(withOpts));

    // Sanity: the two DO differ (PROCESSED gating actually happened), and every
    // active group's expected content is present.
    expect(withoutOpts).not.toContain('PROCESSED');
    expect(withOpts).toContain('PROCESSED (2)');
    for (const out of [withoutOpts, withOpts]) {
      expect(out).toContain('PARKED (1)');
      expect(out).toContain('pk1');
      expect(out).toContain('HALTED (1)');
      expect(out).toContain('h1');
      expect(out).toContain('IN-PROGRESS (1)');
      expect(out).toContain('ip1');
      expect(out).toContain('GATED (1)');
      expect(out).toContain('g1');
      expect(out).toContain('WAITING (1)');
      expect(out).toContain('w1');
      expect(out).toContain('ELIGIBLE (2)');
      expect(out).toContain('e1');
      expect(out).toContain('e2');
    }
  });

  it('active groups are byte-identical with opts omitted vs. { includeCompleted: false }', () => {
    const omitted = renderDashboard(representativeState);
    const explicitFalse = renderDashboard(representativeState, { includeCompleted: false });
    expect(omitted).toEqual(explicitFalse);
  });
});

describe('engine/daemon-dashboard — band annotations and fallback marker (Task 14)', () => {
  it('ELIGIBLE group band annotations: lines in ELIGIBLE section gain [band] suffixes from item band field', () => {
    const state: InheritedState = {
      halted: [],
      inProgress: [],
      eligible: [
        { slug: 'e1', tier: 'S', band: 'high' },
        { slug: 'e2', band: 'medium' },
        { slug: 'e3', band: 'low' },
        { slug: 'e4', band: 'unlabeled' },
        { slug: 'e5', band: 'no-issue' },
      ],
      processed: [],
      processedCount: 0,
    };
    const resolution: PriorityResolution = {
      mode: 'banded',
      bands: new Map([
        ['e1', 'high'],
        ['e2', 'medium'],
        ['e3', 'low'],
        ['e4', 'unlabeled'],
        ['e5', 'no-issue'],
      ]),
    };
    const out = renderDashboard(state, undefined, resolution);
    expect(out).toContain('e1 [S] [high]');
    expect(out).toContain('e2 [medium]');
    expect(out).toContain('e3 [low]');
    expect(out).toContain('e4 [unlabeled]');
    expect(out).toContain('e5 [no-issue]');
  });

  it('Fallback mode marker: when priority resolver mode is fallback, dashboard adds one marker line instead of band suffixes', () => {
    const state: InheritedState = {
      halted: [],
      inProgress: [],
      eligible: [
        { slug: 'e1', band: 'high' },
        { slug: 'e2', band: 'medium' },
      ],
      processed: [],
      processedCount: 0,
    };
    const resolution: PriorityResolution = { mode: 'fallback' };
    const out = renderDashboard(state, undefined, resolution);
    expect(out).toContain('(priority: chronological fallback)');
    expect(out).toContain('• e1');
    expect(out).toContain('• e2');
    // Should NOT contain band annotations when in fallback mode
    expect(out).not.toContain('[high]');
    expect(out).not.toContain('[medium]');
  });

  it('Empty backlog: dashboard renders clean with no band annotations', () => {
    const state: InheritedState = {
      halted: [],
      inProgress: [],
      eligible: [],
      processed: [],
      processedCount: 0,
    };
    const resolution: PriorityResolution = {
      mode: 'banded',
      bands: new Map(),
    };
    const out = renderDashboard(state, { includeCompleted: true }, resolution);
    expect(out).toContain('ELIGIBLE (0)');
    expect(out).toContain('HALTED (0)');
    expect(out).toContain('IN-PROGRESS (0)');
    expect(out).toContain('PROCESSED (0)');
    // Should not contain any band markers or fallback marker
    expect(out).not.toContain('[high]');
    expect(out).not.toContain('[medium]');
    expect(out).not.toContain('chronological fallback');
  });

  it('Four-group structure preserved: output maintains existing structure with band annotations', () => {
    const state: InheritedState = {
      halted: [{ slug: 'h1', reason: 'parked', tier: 'M' }],
      inProgress: [{ slug: 'ip1', step: 'build', tier: 'S' }],
      eligible: [{ slug: 'e1', band: 'high' }],
      processed: [{ slug: 'p1' }],
      processedCount: 1,
    };
    const resolution: PriorityResolution = {
      mode: 'banded',
      bands: new Map([['e1', 'high']]),
    };
    const out = renderDashboard(state, { includeCompleted: true }, resolution);
    // Check all four groups are present with correct structure
    expect(out).toContain('HALTED (1)');
    expect(out).toContain('h1');
    expect(out).toContain('IN-PROGRESS (1)');
    expect(out).toContain('ip1');
    expect(out).toContain('ELIGIBLE (1)');
    expect(out).toContain('e1 [high]');
    expect(out).toContain('PROCESSED (1)');
    expect(out).toContain('p1');
  });

  it('Fallback mode deactivates annotations: when in fallback mode, NO band suffixes shown', () => {
    const state: InheritedState = {
      halted: [],
      inProgress: [],
      eligible: [
        { slug: 'e1', band: 'high' },
        { slug: 'e2', band: 'medium' },
        { slug: 'e3', band: 'low' },
      ],
      processed: [],
      processedCount: 0,
    };
    const resolution: PriorityResolution = { mode: 'fallback' };
    const out = renderDashboard(state, undefined, resolution);
    // Lines should exist without band annotations
    expect(out).toContain('• e1');
    expect(out).toContain('• e2');
    expect(out).toContain('• e3');
    // Should have marker line
    expect(out).toContain('(priority: chronological fallback)');
    // Should NOT have any band suffixes
    expect(out).not.toContain('[high]');
    expect(out).not.toContain('[medium]');
    expect(out).not.toContain('[low]');
  });
});
