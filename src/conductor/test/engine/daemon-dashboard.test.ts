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
});

describe('engine/daemon-dashboard — renderDashboard (FR-1/FR-2)', () => {
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
    const out = renderDashboard(state);
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

  it('zero-state renders all four groups at 0', () => {
    const out = renderDashboard({
      halted: [],
      inProgress: [],
      eligible: [],
      processed: [],
      processedCount: 0,
    });
    expect(out).toContain('HALTED (0)');
    expect(out).toContain('IN-PROGRESS (0)');
    expect(out).toContain('ELIGIBLE (0)');
    expect(out).toContain('PROCESSED (0)');
  });
});
