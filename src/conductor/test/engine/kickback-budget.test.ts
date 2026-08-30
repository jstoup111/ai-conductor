// Covers: task:2
import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  deriveKickbackBudgetView,
  renderKickbackBudgetViewHuman,
  renderKickbackBudgetViewJson,
  applyKickbackBudgetMutation,
} from '../../src/engine/kickback-budget.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';
import type { KickbackGateEntry } from '../../src/engine/kickback-ledger.js';

function entry(overrides: Partial<KickbackGateEntry> = {}): KickbackGateEntry {
  return {
    count: 0,
    cumulative: 3,
    treeHash: null,
    lastReason: 'The implementation does not satisfy the negative path.',
    priorVerdict: false,
    resolvedBefore: 0,
    ...overrides,
  };
}

describe('kickback budget view', () => {
  it('derives and renders the semantic budget consistently in human and JSON formats', () => {
    const view = deriveKickbackBudgetView('recover-feature', entry({
      effectiveLimit: 5,
      mechanicalFaults: 2,
      lastMechanicalFault: {
        rubric: 'testQuality',
        reason: 'preflight-failed',
        detail: 'fixture source was unavailable',
        lapId: 'mechanical-lap-1',
      },
    }));

    expect(view).toMatchObject({
      feature: 'recover-feature',
      gate: 'build_review',
      count: 3,
      limit: 5,
      remaining: 2,
      exhausted: false,
      latestReason: 'The implementation does not satisfy the negative path.',
      mechanicalFaults: {
        count: 2,
        excludedFromSemanticBudget: true,
      },
    });

    expect(renderKickbackBudgetViewHuman(view)).toContain('Count: 3');
    expect(renderKickbackBudgetViewHuman(view)).toContain('Limit: 5');
    expect(renderKickbackBudgetViewHuman(view)).toContain('Remaining: 2');
    expect(renderKickbackBudgetViewHuman(view)).toContain('Exhausted: false');
    expect(renderKickbackBudgetViewHuman(view)).toContain('Mechanical faults (excluded from semantic budget): 2');
    expect(JSON.parse(renderKickbackBudgetViewJson(view))).toMatchObject({
      count: 3,
      limit: 5,
      remaining: 2,
      exhausted: false,
      mechanicalFaults: { count: 2, excludedFromSemanticBudget: true },
    });
  });

  it('clamps remaining allowance at zero once the semantic budget is exhausted', () => {
    const view = deriveKickbackBudgetView('recover-feature', entry({ cumulative: 6, effectiveLimit: 5 }));

    expect(view).toMatchObject({ count: 6, limit: 5, remaining: 0, exhausted: true });
  });

  it('renders recorded adjustment history in chronological order without changing semantic figures', () => {
    const view = deriveKickbackBudgetView('recover-feature', entry({
      effectiveLimit: 8,
      adjustments: [
        {
          id: 'raise-2', kind: 'raise', beforeCount: 0, afterCount: 0, beforeLimit: 6, afterLimit: 8,
          operator: 'alex', rationale: 'second extension', at: '2026-08-30T12:00:00.000Z',
        },
        {
          id: 'reset-1', kind: 'reset', beforeCount: 6, afterCount: 0, beforeLimit: 5, afterLimit: 5,
          operator: 'alex', rationale: 'old findings were obsolete', at: '2026-08-30T10:00:00.000Z',
        },
        {
          id: 'raise-1', kind: 'raise', beforeCount: 0, afterCount: 0, beforeLimit: 5, afterLimit: 6,
          operator: 'blair', rationale: 'first extension', at: '2026-08-30T11:00:00.000Z',
        },
      ],
    }));

    expect(view.adjustments).toMatchObject({
      availability: 'available',
      entries: [
        { id: 'reset-1' },
        { id: 'raise-1' },
        { id: 'raise-2' },
      ],
    });
    expect(view).toMatchObject({ count: 3, limit: 8, remaining: 5 });
    expect(renderKickbackBudgetViewHuman(view)).toMatch(/reset-1[\s\S]*raise-1[\s\S]*raise-2/);
    expect(JSON.parse(renderKickbackBudgetViewJson(view)).adjustments.entries.map((adjustment: { id: string }) => adjustment.id))
      .toEqual(['reset-1', 'raise-1', 'raise-2']);
  });

  it('labels legacy adjustment history unavailable without inferring it from the latest reason', () => {
    const view = deriveKickbackBudgetView('legacy-feature', entry({
      lastReason: 'The last finding says somebody reset this last Tuesday.',
    }));

    expect(view.adjustments).toEqual({ availability: 'unavailable', entries: [] });
    expect(renderKickbackBudgetViewHuman(view)).toContain('Adjustment history: unavailable');
    expect(JSON.parse(renderKickbackBudgetViewJson(view)).adjustments).toEqual({
      availability: 'unavailable',
      entries: [],
    });
  });
});

describe('kickback budget recovery transaction', () => {
  it('records one reset authorization and preserves the feature-local effective limit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kickback-budget-mutation-'));
    try {
      await mkdir(join(root, '.pipeline'), { recursive: true });
      await writeFile(join(root, '.pipeline/kickback-ledger.json'), JSON.stringify({ version: 1, gates: {
        build_review: entry({ cumulative: 6, effectiveLimit: 8, adjustments: [], exhaustedEvidence: {
          gate: 'build_review', count: 6, limit: 8, generation: 'g-1', latestReason: 'repeat',
        } }),
      } }));
      const adjustmentId = 'reset-1-2-3-4';
      await expect(applyKickbackBudgetMutation(root, 'feature', 'operator', 'obsolete episode', { kind: 'reset' }, 'g-1', adjustmentId))
        .resolves.toMatchObject({ ok: true, adjustment: { id: adjustmentId, afterCount: 0, afterLimit: 8 } });
      await expect(readKickbackLedger(root)).resolves.toMatchObject({ gates: { build_review: {
        cumulative: 0, effectiveLimit: 8, adjustments: [{ id: adjustmentId, kind: 'reset' }],
        resumeAuthorization: { adjustmentId, generation: 'g-1' },
      } } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
