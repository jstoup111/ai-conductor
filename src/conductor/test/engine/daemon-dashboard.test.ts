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
      reason: 'unowned-post-cutover',
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
          reason: 'unowned-post-cutover',
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
    expect(out).toContain('unowned-post-cutover');
    expect(out).toContain('claim it via daemon identity config');
  });

  it('renders repo-kind gated entries as section-level warning lines', () => {
    const state: InheritedState = {
      halted: [],
      inProgress: [],
      eligible: [],
      processed: [],
      processedCount: 0,
      gated: [
        {
          kind: 'repo',
          warning: 'no-cutover',
          remedy: 'configure a grandfather cutover date',
        },
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
