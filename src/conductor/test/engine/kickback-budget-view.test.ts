// Covers: task:5, task:10, task:12
import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { kickbackBudgetView, renderKickbackBudgetView, renderKickbackRecoveryHint } from '../../src/engine/kickback-budget-view.js';
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

  it('reports a legacy entry with no recovery history as unavailable', () => {
    const legacy = { count: 1, cumulative: 1, treeHash: null, lastReason: '', priorVerdict: false, resolvedBefore: 0 };
    expect(kickbackBudgetView(legacy, 'build_review', 5).adjustments).toBe('unavailable');
    expect(renderKickbackBudgetView(legacy, 'build_review', 5)).toContain('Adjustment history: unavailable');
  });

  it('renders config-derived plan growth without inventing a raised cap', () => {
    const rendered = renderKickbackBudgetView(
      { ...baseEntry, laps: 1, adjustmentsKnown: true },
      'prd_audit',
      2,
      { authored: 10, added: 2, byGate: { prd_audit: 2 }, remaining: 0, cap: 2, capSource: 'config-derived' },
    );
    expect(rendered).toContain('Plan growth: 2/2 added; 0 remaining (config-derived cap)');
    expect(rendered).not.toContain('raised cap');
  });

  it('names the exhausted allowance and renders the exact recovery command', () => {
    expect(renderKickbackRecoveryHint({ slug: 'feat-x', gate: 'prd_audit', allowance: 'growth' })).toBe(
      'Plan-growth allowance exhausted. Recover with: ai-conductor kickback-budget raise --feature feat-x --gate prd_audit --by «N» --rationale "«why»"',
    );
    expect(renderKickbackRecoveryHint({ gate: 'prd_audit', allowance: 'laps' })).toContain('--feature «slug»');
  });

  it('inspects every gate through the CLI and keeps JSON aligned with the rendered gates', async () => {
    const fixture = await makeFeature({ version: 1, gates: {
      build_review: { count: 1, cumulative: 2, adjustmentsKnown: true, treeHash: null, lastReason: 'review', priorVerdict: true, resolvedBefore: 0 },
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
      expect(parsed.gates.find((view) => view.gate === 'build_review')?.adjustments).toEqual([]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('keeps a malformed adjustment history explicitly unavailable in JSON', async () => {
    const fixture = await makeFeature({ version: 1, gates: {
      build_review: {
        count: 1, cumulative: 2, treeHash: null, lastReason: 'review', priorVerdict: true,
        resolvedBefore: 0, adjustments: [{ id: 'missing-required-attribution' }],
      },
    } });
    try {
      const output: string[] = [];
      expect(await dispatchKickbackBudgetCommand(
        { kind: 'kickback-budget', action: 'inspect', feature: 'feature', format: 'json' },
        { cwd: fixture.root, resolveMainRoot: async () => fixture.root, print: (line) => output.push(line) },
      )).toBe(0);

      const parsed = JSON.parse(output[0]) as { gates: Array<{ gate: string; adjustments: unknown }> };
      expect(parsed.gates.find((view) => view.gate === 'build_review')?.adjustments).toBe('unavailable');
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

const baseEntry = { count: 1, cumulative: 1, treeHash: null, lastReason: 'cap', priorVerdict: true, resolvedBefore: 0 };
