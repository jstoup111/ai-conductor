import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanInheritedState } from '../../src/engine/daemon-dashboard.js';
import { renderDashboardLines, formatDashboardSnapshot } from '../../src/ui/dashboard-text.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState } from '../../src/types/index.js';
import type { DashboardSnapshot } from '../../src/ui/types.js';

describe('renderDashboardLines', () => {
  it('renders all steps grouped by phase with pending icons when state is empty', () => {
    const state: ConductState = {};
    const lines = renderDashboardLines(state, ALL_STEPS, 'Add login');

    // Header
    expect(lines[0]).toContain('━');
    expect(lines[1]).toContain('Conductor: Add login');
    expect(lines[2]).toContain('━');

    // Should contain all phase headers
    const text = lines.join('\n');
    expect(text).toContain('SETUP');
    expect(text).toContain('UNDERSTAND');
    expect(text).toContain('DECIDE');
    expect(text).toContain('BUILD');
    expect(text).toContain('SHIP');

    // All steps should appear as pending
    expect(text).toContain('⬚ Worktree');
    expect(text).toContain('⬚ Memory');
    expect(text).toContain('⬚ Finish');
  });

  it('shows complexity tier in header when present in state', () => {
    const state: ConductState = { complexity_tier: 'M' };
    const lines = renderDashboardLines(state, ALL_STEPS, 'Add login');
    const header = lines[1];
    expect(header).toContain('Tier: M');
  });

  it('shows done icon for completed steps', () => {
    const state: ConductState = { worktree: 'done', memory: 'done' };
    const lines = renderDashboardLines(state, ALL_STEPS, 'Test feature');
    const text = lines.join('\n');
    expect(text).toContain('✓ Worktree');
    expect(text).toContain('✓ Memory');
  });

  it('shows in_progress icon for active step', () => {
    const state: ConductState = { worktree: 'done', memory: 'in_progress' };
    const lines = renderDashboardLines(state, ALL_STEPS, 'Test feature');
    const text = lines.join('\n');
    expect(text).toContain('▶ Memory');
  });

  it('shows skipped icon for skipped steps', () => {
    const state: ConductState = { conflict_check: 'skipped' };
    const lines = renderDashboardLines(state, ALL_STEPS, 'Test feature');
    const text = lines.join('\n');
    expect(text).toContain('→ Conflict Check');
  });

  it('shows failed icon for failed steps', () => {
    const state: ConductState = { build: 'failed' };
    const lines = renderDashboardLines(state, ALL_STEPS, 'Test feature');
    const text = lines.join('\n');
    expect(text).toContain('✗ Build');
  });

  it('shows stale icon for stale steps', () => {
    const state: ConductState = { plan: 'stale' };
    const lines = renderDashboardLines(state, ALL_STEPS, 'Test feature');
    const text = lines.join('\n');
    expect(text).toContain('⚠ Plan');
  });

  it('omits tier from header when not set', () => {
    const state: ConductState = {};
    const lines = renderDashboardLines(state, ALL_STEPS, 'Test feature');
    const header = lines[1];
    expect(header).not.toContain('Tier');
  });

  it('uses "(resuming)" when no feature name provided', () => {
    const state: ConductState = {};
    const lines = renderDashboardLines(state, ALL_STEPS);
    const header = lines[1];
    expect(header).toContain('(resuming)');
  });

  it('renders running suffix for in_progress step', () => {
    const state: ConductState = { explore: 'in_progress' };
    const lines = renderDashboardLines(state, ALL_STEPS, 'Test');
    const text = lines.join('\n');
    expect(text).toContain('▶ Explore — running...');
  });

  describe('artifact rendering', () => {
    it('shows ✗ when an artifact pattern has no matches', () => {
      const state: ConductState = { plan: 'done' };
      const lines = renderDashboardLines(state, ALL_STEPS, 'Test', {
        plan: [{ pattern: '.docs/plans/*.md', files: [], satisfied: false }],
      });
      const text = lines.join('\n');
      expect(text).toContain('✗ .docs/plans/*.md — missing');
    });

    it('shows the single matched file under its step', () => {
      const state: ConductState = { plan: 'done' };
      const lines = renderDashboardLines(state, ALL_STEPS, 'Test', {
        plan: [
          {
            pattern: '.docs/plans/*.md',
            files: ['.docs/plans/2026-04-16-thing.md'],
            satisfied: true,
          },
        ],
      });
      const text = lines.join('\n');
      expect(text).toContain('✓ .docs/plans/2026-04-16-thing.md');
    });

    it('summarizes multiple matches with a count + sample', () => {
      const state: ConductState = { stories: 'done' };
      const files = [
        '.docs/stories/s1.md',
        '.docs/stories/s2.md',
        '.docs/stories/s3.md',
        '.docs/stories/s4.md',
      ];
      const lines = renderDashboardLines(state, ALL_STEPS, 'Test', {
        stories: [
          { pattern: '.docs/stories/**/*.md', files, satisfied: true },
        ],
      });
      const text = lines.join('\n');
      expect(text).toContain('.docs/stories/**/*.md (4 files)');
      expect(text).toContain('• .docs/stories/s1.md');
      expect(text).toContain('… +1 more');
    });

    it('does not render artifact lines when artifacts arg is omitted', () => {
      const state: ConductState = { plan: 'done' };
      const lines = renderDashboardLines(state, ALL_STEPS, 'Test');
      const text = lines.join('\n');
      expect(text).not.toContain('.docs/plans/');
    });
  });
});

describe('dashboard provider stream progress reader', () => {
  let root: string;
  let worktreeBase: string;
  let processedDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dashboard-stream-progress-'));
    worktreeBase = join(root, '.worktrees');
    processedDir = join(root, '.daemon', 'processed');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeFeature(slug: string, events?: readonly object[]): Promise<void> {
    const pipeline = join(worktreeBase, slug, '.pipeline');
    await mkdir(pipeline, { recursive: true });
    await writeFile(join(pipeline, 'conduct-state.json'), JSON.stringify({ build: 'in_progress' }));
    if (events) {
      await writeFile(
        join(pipeline, 'events.jsonl'),
        `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
      );
    }
  }

  async function readEntry(slug: string) {
    const state = await scanInheritedState({ worktreeBase, processedDir, discover: async () => [] });
    return state.inProgress.find((entry) => entry.slug === slug);
  }

  it('uses the latest provider stream progress from the current step', async () => {
    await writeFeature('latest', [
      { type: 'step_started', step: 'build', ts: '2026-08-20T12:00:00.000Z' },
      { type: 'provider_stream_progress', step: 'build', childObservability: 'observed', activeChildren: 1, uncachedInputTokens: 10, outputTokens: 2 },
      { type: 'provider_stream_progress', step: 'build', childObservability: 'observed', activeChildren: 2, uncachedInputTokens: 20, cachedInputTokens: 5, outputTokens: 4 },
    ]);

    expect((await readEntry('latest'))?.providerStreamProgress).toEqual({
      childObservability: 'observed',
      activeChildren: 2,
      uncachedInputTokens: 20,
      cachedInputTokens: 5,
      outputTokens: 4,
    });
  });

  it('ignores progress for a different step', async () => {
    await writeFeature('different-step', [
      { type: 'step_started', step: 'build', ts: '2026-08-20T12:00:00.000Z' },
      { type: 'provider_stream_progress', step: 'plan', childObservability: 'observed', activeChildren: 7, uncachedInputTokens: 70, outputTokens: 7 },
    ]);

    expect((await readEntry('different-step'))?.providerStreamProgress).toBeUndefined();
  });

  it('resets progress when a new dispatch for the same step starts', async () => {
    await writeFeature('reset', [
      { type: 'step_started', step: 'build', ts: '2026-08-20T12:00:00.000Z' },
      { type: 'provider_stream_progress', step: 'build', childObservability: 'observed', activeChildren: 1, uncachedInputTokens: 10, outputTokens: 2 },
      { type: 'step_started', step: 'build', ts: '2026-08-20T12:05:00.000Z' },
    ]);

    expect((await readEntry('reset'))?.providerStreamProgress).toBeUndefined();
  });

  it('does not throw for a missing or unreadable event ledger', async () => {
    await writeFeature('missing');
    await writeFeature('unreadable');
    await mkdir(join(worktreeBase, 'unreadable', '.pipeline', 'events.jsonl'));

    await expect(Promise.all([readEntry('missing'), readEntry('unreadable')])).resolves.toEqual([
      expect.objectContaining({ slug: 'missing' }),
      expect.objectContaining({ slug: 'unreadable' }),
    ]);
  });
});

describe('formatDashboardSnapshot: view modes and overlays', () => {
  function baseSnap(): DashboardSnapshot {
    return {
      featureName: 'Add login',
      steps: [
        { name: 'explore', label: 'Explore', phase: 'UNDERSTAND', status: 'done' },
        { name: 'plan', label: 'Plan', phase: 'DECIDE', status: 'in_progress' },
      ],
    };
  }

  it('full view shows the entire step list', () => {
    const text = formatDashboardSnapshot(baseSnap(), { viewMode: 'full' }).join('\n');
    expect(text).toContain('Explore');
    expect(text).toContain('Plan');
  });

  it('focus view hides the full step list', () => {
    const snap = { ...baseSnap(), currentStep: { name: 'plan' as const, label: 'Plan', startedAtMs: Date.now() } };
    const text = formatDashboardSnapshot(snap, { viewMode: 'focus' }).join('\n');
    expect(text).not.toContain('Explore');
    // Current-step banner still appears
    expect(text).toContain('Plan');
  });

  it('log view renders only the tail pane', () => {
    const snap: DashboardSnapshot = {
      ...baseSnap(),
      lastStepTail: { step: 'explore', lines: ['one', 'two', 'three'] },
    };
    const text = formatDashboardSnapshot(snap, { viewMode: 'log', tailLines: 5 }).join('\n');
    expect(text).not.toContain('Conductor: Add login');
    expect(text).toContain('one');
    expect(text).toContain('two');
    expect(text).toContain('three');
  });

  it('log view shows a fallback message when no tail is present', () => {
    const text = formatDashboardSnapshot(baseSnap(), { viewMode: 'log' }).join('\n');
    expect(text).toContain('no step output yet');
  });

  it('renders the current-step banner with an HH:MM:SS timestamp', () => {
    const startedAtMs = new Date('2026-04-17T14:23:05Z').getTime();
    const snap = { ...baseSnap(), currentStep: { name: 'plan' as const, label: 'Plan', startedAtMs } };
    const text = formatDashboardSnapshot(snap).join('\n');
    expect(text).toMatch(/started \d{2}:\d{2}:\d{2}/);
    expect(text).toContain('Plan');
  });

  it('truncates tail to tailLines most recent entries', () => {
    const snap: DashboardSnapshot = {
      ...baseSnap(),
      lastStepTail: { step: 'plan', lines: ['a', 'b', 'c', 'd', 'e'] },
    };
    const text = formatDashboardSnapshot(snap, { tailLines: 2 }).join('\n');
    expect(text).toContain('d');
    expect(text).toContain('e');
    expect(text).not.toContain('> a');
    expect(text).not.toContain('> b');
  });

  it('hides tail pane when tailLines is 0', () => {
    const snap: DashboardSnapshot = {
      ...baseSnap(),
      lastStepTail: { step: 'plan', lines: ['x'] },
    };
    const text = formatDashboardSnapshot(snap, { tailLines: 0 }).join('\n');
    expect(text).not.toContain('Last step output');
    expect(text).not.toContain('> x');
  });
});
