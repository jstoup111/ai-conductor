// Covers: task:10, task:12
import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { kickbackBudgetView, renderKickbackBudgetView } from '../../src/engine/kickback-budget-view.js';
import { dispatchKickbackBudgetCommand } from '../../src/engine/kickback-budget-cli.js';

async function makeFeature(ledger: unknown): Promise<{ root: string; worktree: string }> {
  const root = await mkdtemp(join(tmpdir(), 'kickback-budget-view-'));
  const worktree = join(root, '.worktrees', 'feature');
  await mkdir(join(worktree, '.pipeline'), { recursive: true });
  await writeFile(join(worktree, '.pipeline', 'kickback-ledger.json'), JSON.stringify(ledger));
  return { root, worktree };
}

describe('kickback budget view', () => {
  it('renders the charged budget, reason, history, and mechanical faults', () => {
    const entry = {
      count: 2, cumulative: 5, treeHash: null, lastReason: 'grader finding', priorVerdict: true,
      resolvedBefore: 0, effectiveLimit: 6, mechanicalFaults: 1,
      adjustments: [{ id: 'raise-1', kind: 'raise' as const, beforeConsumed: 5, afterConsumed: 5,
        beforeLimit: 5, afterLimit: 6, operator: 'operator', rationale: 'one more pass',
        timestamp: '2026-09-06T00:00:00.000Z', haltGeneration: 'halt-1' }],
    };
    const rendered = renderKickbackBudgetView(entry, 'build_review', 5);
    expect(rendered).toContain('5/6 consumed; 1 remaining');
    expect(rendered).toContain('Latest reason: grader finding');
    expect(rendered).toContain('Adjustment history: raise raise-1');
    expect(rendered).toContain('Mechanical faults: 1');
  });

  it('reports an empty history for an existing never-adjusted entry', () => {
    const legacy = { count: 1, cumulative: 1, treeHash: null, lastReason: '', priorVerdict: false, resolvedBefore: 0 };
    expect(kickbackBudgetView(legacy, 'build_review', 5).adjustments).toEqual([]);
    expect(renderKickbackBudgetView(legacy, 'build_review', 5)).toContain('Adjustment history: none');
  });

  it('inspects every gate through the CLI and keeps JSON aligned with the rendered gates', async () => {
    const fixture = await makeFeature({ version: 1, gates: {
      build_review: { count: 1, cumulative: 2, treeHash: null, lastReason: 'review', priorVerdict: true, resolvedBefore: 0 },
      prd_audit: { count: 1, cumulative: 1, laps: 1, treeHash: null, lastReason: 'audit', priorVerdict: true, resolvedBefore: 0 },
      architecture_review_as_built: { count: 0, cumulative: 0, laps: 0, treeHash: null, lastReason: '', priorVerdict: false, resolvedBefore: 0 },
    } });
    try {
      const human: string[] = [];
      expect(await dispatchKickbackBudgetCommand(
        { kind: 'kickback-budget', action: 'inspect', feature: 'feature', format: 'human' },
        { cwd: fixture.root, resolveMainRoot: async () => fixture.root, print: (line) => human.push(line) },
      )).toBe(0);
      const json: string[] = [];
      expect(await dispatchKickbackBudgetCommand(
        { kind: 'kickback-budget', action: 'inspect', feature: 'feature', format: 'json' },
        { cwd: fixture.root, resolveMainRoot: async () => fixture.root, print: (line) => json.push(line) },
      )).toBe(0);

      for (const gate of ['build_review', 'prd_audit', 'architecture_review_as_built']) expect(human[0]).toContain(`Kickback budget (${gate}):`);
      expect(json).toHaveLength(1);
      const parsed = JSON.parse(json[0]) as { gates: Array<{ gate: string; adjustments: unknown }> };
      expect(parsed.gates.map((view) => view.gate)).toEqual(['build_review', 'prd_audit', 'architecture_review_as_built']);
      expect(parsed.gates.every((view) => 'adjustments' in view)).toBe(true);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('refuses a corrupt ledger instead of rendering a default budget view', async () => {
    const fixture = await makeFeature('{not json');
    try {
      const output: string[] = [];
      expect(await dispatchKickbackBudgetCommand(
        { kind: 'kickback-budget', action: 'inspect', feature: 'feature', format: 'human' },
        { cwd: fixture.root, resolveMainRoot: async () => fixture.root, print: (line) => output.push(line) },
      )).toBe(1);
      expect(output).toEqual(['kickback-budget: ledger is unreadable.']);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
