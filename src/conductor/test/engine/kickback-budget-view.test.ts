// Covers: task:3, task:5, task:6, task:8, task:10, task:12
import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { kickbackBudgetView, renderKickbackBudgetView, renderKickbackRecoveryHint, withPendingGrowth } from '../../src/engine/kickback-budget-view.js';
import { dispatchKickbackBudgetCommand } from '../../src/engine/kickback-budget-cli.js';
import { projectPendingGrowth } from '../../src/engine/kickback-ledger.js';

async function makeFeature(ledger: unknown, config?: string): Promise<{ root: string; worktree: string }> {
  const root = await mkdtemp(join(tmpdir(), 'kickback-budget-view-'));
  const worktree = join(root, '.worktrees', 'feature');
  await mkdir(join(worktree, '.pipeline'), { recursive: true });
  await writeFile(join(worktree, '.pipeline', 'kickback-ledger.json'), JSON.stringify(ledger));
  if (config) {
    await mkdir(join(worktree, '.ai-conductor'), { recursive: true });
    await writeFile(join(worktree, '.ai-conductor', 'config.yml'), config);
  }
  return { root, worktree };
}

async function inspectFeature(fixture: { root: string }): Promise<{
  human: string;
  gates: Array<{ gate: string; consumed: number; limit: number; remaining: number; pendingLaps?: number }>;
}> {
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
  return { human: human[0], gates: (JSON.parse(json[0]) as { gates: Array<{ gate: string; consumed: number; limit: number; remaining: number; pendingLaps?: number }> }).gates };
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

  // Covers: task:6
  it.each([
    ['prd_audit', { tier: 'L' as const, limit: 4, source: 'default' as const }, 'tier L allowance 4 (default)'],
    ['architecture_review_as_built', { tier: 'M' as const, limit: 5, source: 'configured' as const }, 'tier M allowance 5 (configured)'],
    ['prd_audit', { tier: undefined, limit: 3, source: 'default' as const }, 'tier unrecorded, treated as M; allowance 3 (default)'],
  ])('renders remediation allowance suffixes for %s', (gate, allowance, suffix) => {
    const rendered = renderKickbackBudgetView(
      { ...baseEntry, laps: 1, adjustmentsKnown: true },
      gate,
      allowance.limit,
      undefined,
      undefined,
      undefined,
      0,
      allowance,
    );

    expect(rendered).toContain(`Kickback budget (${gate}): 1/${allowance.limit} consumed; ${allowance.limit - 1} remaining — ${suffix}`);
    expect(kickbackBudgetView(
      { ...baseEntry, laps: 1, adjustmentsKnown: true }, gate, allowance.limit, undefined, undefined, 0, allowance,
    )).toMatchObject({ tier: allowance.tier ?? null, allowanceSource: allowance.source });
  });

  // Covers: task:6
  it('reports raised remediation allowances from their resolved allowance', () => {
    const allowance = { tier: 'S' as const, limit: 2, source: 'default' as const };
    const entry = { ...baseEntry, laps: 2, effectiveLapCap: 4, adjustmentsKnown: true as const };

    expect(renderKickbackBudgetView(entry, 'prd_audit', allowance.limit, undefined, undefined, undefined, 0, allowance)).toContain(
      'Kickback budget (prd_audit): 2/4 consumed; 2 remaining — tier S allowance 4 (raised from 2)',
    );
    expect(kickbackBudgetView(entry, 'prd_audit', allowance.limit, undefined, undefined, 0, allowance)).toMatchObject({
      tier: 'S', allowanceSource: 'raised',
    });
  });

  // Covers: task:6
  it('keeps build_review rendering and JSON free of remediation allowance metadata', () => {
    const view = kickbackBudgetView(
      { ...baseEntry, cumulative: 4, effectiveLimit: 6, adjustmentsKnown: true },
      'build_review',
      5,
      undefined,
      undefined,
      0,
      { tier: 'L', limit: 4, source: 'default' },
    );

    expect(renderKickbackBudgetView(
      { ...baseEntry, cumulative: 4, effectiveLimit: 6, adjustmentsKnown: true },
      'build_review', 5, undefined, undefined, undefined, 0, { tier: 'L', limit: 4, source: 'default' },
    )).toContain('Kickback budget (build_review): 4/6 consumed; 2 remaining');
    expect(view).not.toHaveProperty('tier');
    expect(view).not.toHaveProperty('allowanceSource');
  });

  it('reports a legacy entry with no recovery history as unavailable', () => {
    const legacy = { count: 1, cumulative: 1, treeHash: null, lastReason: '', priorVerdict: false, resolvedBefore: 0 };
    expect(kickbackBudgetView(legacy, 'build_review', 5).adjustments).toBe('unavailable');
    expect(renderKickbackBudgetView(legacy, 'build_review', 5)).toContain('Adjustment history: unavailable');
  });

  it('labels a child-scoped rendered budget once above its gate block', () => {
    const rendered = renderKickbackBudgetView(
      { count: 2, cumulative: 2, treeHash: null, lastReason: 'child finding', priorVerdict: false, resolvedBefore: 0 },
      'build_review',
      5,
      undefined,
      undefined,
      2 as import('../../src/engine/child-context.js').ChildId,
    );
    expect(rendered).toMatch(/^Child: 2\nKickback budget \(build_review\):/);
    expect(rendered.match(/^Child: 2$/gm)).toHaveLength(1);
  });

  it.each([
    ['none', {}, 'live-halt', undefined, 'Resume authorization: none'],
    ['consumed', { resumeAuthorization: { adjustmentId: 'adjustment-1', haltGeneration: 'bound-halt', consumed: true } }, 'live-halt', 'consumed', 'Resume authorization: consumed'],
    ['awaiting-sweep', { capEvidence: { gate: 'build_review', consumed: 1, limit: 5, latestReason: 'cap', haltGeneration: 'live-halt' }, resumeAuthorization: { adjustmentId: 'adjustment-1', haltGeneration: 'live-halt', consumed: false } }, 'live-halt', 'awaiting-sweep', 'Resume authorization: awaiting daemon sweep'],
    ['stale', { resumeAuthorization: { adjustmentId: 'adjustment-1', haltGeneration: 'bound-halt', consumed: false } }, 'live-halt', 'stale', 'Resume authorization: stale (bound to halt generation bound-halt; live halt generation live-halt); the daemon will not consume it'],
    ['stale-conflicting-cap-evidence', { capEvidence: { gate: 'build_review', consumed: 1, limit: 5, latestReason: 'cap', haltGeneration: 'evidence-halt' }, resumeAuthorization: { adjustmentId: 'adjustment-1', haltGeneration: 'live-halt', consumed: false } }, 'live-halt', 'stale', 'Resume authorization: stale (bound to halt generation live-halt; live halt generation live-halt); the daemon will not consume it'],
    ['live-halt-not-read', { resumeAuthorization: { adjustmentId: 'adjustment-1', haltGeneration: 'bound-halt', consumed: false } }, undefined, 'pending', 'Resume authorization: pending (live halt not read)'],
  ] as const)('renders resume authorization %s in JSON and human output', (_name, additions, liveHaltGeneration, state, line) => {
    const entry = { ...baseEntry, adjustmentsKnown: true as const, ...additions };
    const view = kickbackBudgetView(entry, 'build_review', 5, undefined, liveHaltGeneration);
    if (state === undefined) expect(view.resumeAuthorization).toBeUndefined();
    else expect(view.resumeAuthorization).toEqual({
      state,
      adjustmentId: 'adjustment-1',
      boundHaltGeneration: state === 'awaiting-sweep' || _name === 'stale-conflicting-cap-evidence' ? 'live-halt' : 'bound-halt',
      liveHaltGeneration: liveHaltGeneration ?? '',
    });
    expect(renderKickbackBudgetView(entry, 'build_review', 5, undefined, liveHaltGeneration)).toContain(line);
  });

  it('renders config-derived plan growth without inventing a raised cap', () => {
    const rendered = renderKickbackBudgetView(
      { ...baseEntry, laps: 1, adjustmentsKnown: true },
      'prd_audit',
      2,
      { authored: 10, added: 2, byGate: { prd_audit: 2 }, remaining: 0, cap: 2, capSource: 'config-derived', authoredSource: 'plan' },
    );
    expect(rendered).toContain('Plan growth: 2/2 added; 0 remaining (config-derived cap)');
    expect(rendered).not.toContain('raised cap');
  });

  it('renders an unresolved unraised plan growth view without a numeric cap', () => {
    const rendered = renderKickbackBudgetView(
      baseEntry,
      'build_review',
      5,
      { authored: 0, added: 0, byGate: {}, remaining: 0, cap: null, capSource: 'config-derived', authoredSource: 'unresolved' },
    );
    expect(rendered).toContain('Plan growth: plan unresolved; 0 added');
    expect(rendered).not.toContain('config-derived cap');
  });

  // Covers: task:3
  it('renders pending growth immediately after the exhausted config-derived plan growth view', () => {
    const view = withPendingGrowth(
      { authored: 40, added: 0, byGate: {}, remaining: 0, cap: 10, capSource: 'config-derived', authoredSource: 'plan' },
      { charges: {
        prd_audit: { laps: 1, growth: 3 },
        architecture_review_as_built: { laps: 1, growth: 8 },
      } },
    );

    expect(view.pendingGrowth).toEqual({
      total: 11,
      byGate: { prd_audit: 3, architecture_review_as_built: 8 },
      projected: 11,
      minimumRaise: 1,
    });
    expect(Object.keys(view.pendingGrowth ?? {})).toEqual(['total', 'byGate', 'projected', 'minimumRaise']);
    expect(renderKickbackBudgetView(baseEntry, 'prd_audit', 2, view)).toContain(
      'Plan growth: 0/10 added; 0 remaining (config-derived cap)\nPending growth: 11 (prd_audit 3, architecture_review_as_built 8); would reach 11/10 when build dispatches; minimum raise 1',
    );
  });

  // Covers: task:3
  it('renders pending growth that remains within the plan growth cap without a minimum raise', () => {
    const view = withPendingGrowth(
      { authored: 40, added: 2, byGate: { prd_audit: 2 }, remaining: 8, cap: 10, capSource: 'config-derived', authoredSource: 'plan' },
      { charges: { prd_audit: { laps: 1, growth: 3 } } },
    );
    const rendered = renderKickbackBudgetView(baseEntry, 'prd_audit', 2, view);

    expect(rendered).toContain(
      'Plan growth: 2/10 added; 5 remaining (config-derived cap)\nPending growth: 3 (prd_audit 3); would reach 5/10 when build dispatches',
    );
    expect(rendered).not.toContain('minimum raise');
  });

  // Covers: task:3
  it('renders pending growth without a cap projection when the growth cap is unknown', () => {
    const view = withPendingGrowth(
      { authored: 40, added: 2, byGate: { prd_audit: 2 }, remaining: 0, cap: null, capSource: 'config-derived', authoredSource: 'plan' },
      { charges: { prd_audit: { laps: 1, growth: 3 } } },
    );
    const rendered = renderKickbackBudgetView(baseEntry, 'prd_audit', 2, view);

    expect(rendered.split('\n').find((line) => line.startsWith('Pending growth:'))).toBe('Pending growth: 3 (prd_audit 3)');
    expect(rendered).not.toContain('would reach');
    expect(rendered).not.toContain('minimum raise');
  });

  // Covers: task:3
  it('leaves plan growth unchanged for a laps-only pending charge', () => {
    const planGrowth = { authored: 40, added: 2, byGate: { prd_audit: 2 }, remaining: 5, cap: 10, capSource: 'config-derived' as const, authoredSource: 'plan' as const };
    const view = withPendingGrowth(planGrowth, { charges: { prd_audit: { laps: 1, growth: 0 } } });

    expect(view).not.toHaveProperty('pendingGrowth');
    expect(renderKickbackBudgetView(baseEntry, 'prd_audit', 2, view)).toBe(
      renderKickbackBudgetView(baseEntry, 'prd_audit', 2, planGrowth),
    );
  });

  it('names the exhausted allowance and renders the exact recovery command', () => {
    expect(renderKickbackRecoveryHint({ slug: 'feat-x', gate: 'prd_audit', allowance: 'growth' })).toBe(
      'Plan-growth allowance exhausted. Recover with: ai-conductor kickback-budget raise --feature feat-x --gate prd_audit --by «N» --rationale "«why»"',
    );
    expect(renderKickbackRecoveryHint({ gate: 'prd_audit', allowance: 'laps' })).toContain('--feature «slug»');
  });

  // Covers: task:3
  it('renders a concrete recovery raise when supplied and keeps the placeholder when omitted', () => {
    expect(renderKickbackRecoveryHint({ slug: 'feat-x', gate: 'architecture_review_as_built', allowance: 'growth', by: 1 })).toBe(
      'Plan-growth allowance exhausted. Recover with: ai-conductor kickback-budget raise --feature feat-x --gate architecture_review_as_built --by 1 --rationale "«why»"',
    );
    expect(renderKickbackRecoveryHint({ slug: 'feat-x', gate: 'architecture_review_as_built', allowance: 'growth' })).toContain('--by «N»');
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

  // Covers: task:1
  it('uses the configured remediation lap cap when a gate has no ledger entry', async () => {
    const fixture = await makeFeature(
      { version: 1, gates: {} },
      'architecture_review_as_built:\n  max_remediation_laps: 3\n',
    );
    try {
      const output: string[] = [];
      expect(await dispatchKickbackBudgetCommand(
        { kind: 'kickback-budget', action: 'inspect', feature: 'feature', format: 'human' },
        { cwd: fixture.root, resolveMainRoot: async () => fixture.root, print: (line) => output.push(line) },
      )).toBe(0);

      expect(output[0]).toContain('Kickback budget (architecture_review_as_built): 0/3 consumed; 3 remaining');
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  // Covers: task:2
  it('counts an uncharged as-built pending lap in the remaining budget', async () => {
    const fixture = await makeFeature({ version: 1, gates: {
      architecture_review_as_built: { count: 0, cumulative: 0, laps: 0, treeHash: null, lastReason: '', priorVerdict: false, resolvedBefore: 0 },
    }, pendingRepair: {
      receiptId: 'repair-1', taskIds: ['rem-as-built-1'],
      charges: { architecture_review_as_built: { laps: 1, growth: 0 } },
    } }, 'architecture_review_as_built:\n  max_remediation_laps: 1\n');
    try {
      const inspected = await inspectFeature(fixture);
      expect(inspected.human).toContain('Kickback budget (architecture_review_as_built): 0/1 consumed; 0 remaining');
      expect(inspected.human).toContain('Pending charge: 1 lap (charged when build dispatches)');
      expect(inspected.gates.find((gate) => gate.gate === 'architecture_review_as_built')).toMatchObject({
        consumed: 0, limit: 1, pendingLaps: 1, remaining: 0,
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  // Covers: task:2
  it('does not apply a sibling pending charge to the as-built budget', async () => {
    const fixture = await makeFeature({ version: 1, gates: {
      architecture_review_as_built: { count: 0, cumulative: 0, laps: 0, treeHash: null, lastReason: '', priorVerdict: false, resolvedBefore: 0 },
    }, pendingRepair: {
      receiptId: 'repair-1', taskIds: ['rem-prd-1'],
      charges: { prd_audit: { laps: 1, growth: 0 } },
    } }, 'architecture_review_as_built:\n  max_remediation_laps: 1\n');
    try {
      const inspected = await inspectFeature(fixture);
      const asBuiltBlock = inspected.human.split('\n\n').find((block) => block.includes('Kickback budget (architecture_review_as_built):'));
      expect(asBuiltBlock).not.toContain('Pending charge:');
      expect(inspected.gates.find((gate) => gate.gate === 'architecture_review_as_built')).toMatchObject({
        pendingLaps: 0, remaining: 1,
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  // Covers: task:2
  it('floors remaining budget at zero when an already-consumed lap is pending again', async () => {
    const fixture = await makeFeature({ version: 1, gates: {
      architecture_review_as_built: { count: 0, cumulative: 0, laps: 1, treeHash: null, lastReason: '', priorVerdict: false, resolvedBefore: 0 },
    }, pendingRepair: {
      receiptId: 'repair-1', taskIds: ['rem-as-built-1'],
      charges: { architecture_review_as_built: { laps: 1, growth: 0 } },
    } }, 'architecture_review_as_built:\n  max_remediation_laps: 1\n');
    try {
      const inspected = await inspectFeature(fixture);
      expect(inspected.human).toContain('Kickback budget (architecture_review_as_built): 1/1 consumed; 0 remaining');
      expect(inspected.human).toContain('Pending charge: 1 lap (charged when build dispatches)');
      expect(inspected.gates.find((gate) => gate.gate === 'architecture_review_as_built')).toMatchObject({
        consumed: 1, limit: 1, pendingLaps: 1, remaining: 0,
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  // Covers: task:2
  it('renders plural pending remediation laps', () => {
    const rendered = renderKickbackBudgetView(
      { ...baseEntry, laps: 0, adjustmentsKnown: true },
      'architecture_review_as_built',
      3,
      undefined,
      undefined,
      undefined,
      2,
    );
    expect(rendered).toContain('1 remaining');
    expect(rendered).toContain('Pending charge: 2 laps (charged when build dispatches)');
  });

  // Covers: task:6
  it('shows a pending two-gate growth projection through inspect human and JSON output', async () => {
    const charges = {
      prd_audit: { laps: 1, growth: 3 },
      architecture_review_as_built: { laps: 1, growth: 8 },
    };
    const fixture = await makeFeature({
      version: 1,
      gates: {},
      growth: { authored: 40, added: 0, byGate: {} },
      pendingRepair: { receiptId: 'repair-1', taskIds: ['rem-prd-1', 'rem-as-built-1'], charges },
    }, 'prd_audit:\n  max_appended_tasks: 10\n  max_appended_ratio: 1\n');
    try {
      const human: string[] = [];
      const json: string[] = [];
      for (const [format, output] of [['human', human], ['json', json]] as const) {
        expect(await dispatchKickbackBudgetCommand(
          { kind: 'kickback-budget', action: 'inspect', feature: 'feature', format },
          { cwd: fixture.root, resolveMainRoot: async () => fixture.root, print: (line) => output.push(line) },
        )).toBe(0);
      }

      const expected = projectPendingGrowth(0, charges, 10);
      const expectedView = { total: 11, byGate: { prd_audit: 3, architecture_review_as_built: 8 }, projected: 11, minimumRaise: 1 };
      expect(expected).toMatchObject(expectedView);
      for (const gate of ['prd_audit', 'architecture_review_as_built']) {
        const block = human[0].split('\n\n').find((candidate) => candidate.includes(`Kickback budget (${gate}):`));
        expect(block).toContain('Plan growth: 0/10 added; 0 remaining (config-derived cap)\nPending growth: 11 (prd_audit 3, architecture_review_as_built 8); would reach 11/10 when build dispatches; minimum raise 1');
      }
      const views = (JSON.parse(json[0]) as { gates: Array<{ gate: string; planGrowth?: unknown }> }).gates;
      for (const gate of ['prd_audit', 'architecture_review_as_built']) {
        expect(views.find((view) => view.gate === gate)?.planGrowth).toMatchObject({ remaining: 0, pendingGrowth: expectedView });
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  // Covers: task:6
  it('keeps pending growth absent for no-growth pending repairs and projects remaining capacity through inspect', async () => {
    const pendingFixture = await makeFeature({
      version: 1,
      gates: {},
      growth: { authored: 40, added: 2, byGate: { prd_audit: 2 } },
      pendingRepair: { receiptId: 'repair-1', taskIds: ['rem-prd-1'], charges: { prd_audit: { laps: 1, growth: 3 } } },
    }, 'prd_audit:\n  max_appended_tasks: 10\n  max_appended_ratio: 1\n');
    const lapsOnlyFixture = await makeFeature({
      version: 1,
      gates: {},
      growth: { authored: 40, added: 2, byGate: { prd_audit: 2 } },
      pendingRepair: { receiptId: 'repair-2', taskIds: ['rem-prd-2'], charges: { prd_audit: { laps: 1, growth: 0 } } },
    }, 'prd_audit:\n  max_appended_tasks: 10\n  max_appended_ratio: 1\n');
    try {
      const pendingHuman: string[] = [];
      const pendingJson: string[] = [];
      for (const [format, output] of [['human', pendingHuman], ['json', pendingJson]] as const) {
        expect(await dispatchKickbackBudgetCommand(
          { kind: 'kickback-budget', action: 'inspect', feature: 'feature', format },
          { cwd: pendingFixture.root, resolveMainRoot: async () => pendingFixture.root, print: (line) => output.push(line) },
        )).toBe(0);
      }
      expect(pendingHuman[0]).toContain('Plan growth: 2/10 added; 5 remaining (config-derived cap)\nPending growth: 3 (prd_audit 3); would reach 5/10 when build dispatches');
      expect(pendingHuman[0]).not.toContain('minimum raise');
      const pendingViews = (JSON.parse(pendingJson[0]) as { gates: Array<{ gate: string; planGrowth?: unknown }> }).gates;
      expect(pendingViews.find((view) => view.gate === 'prd_audit')?.planGrowth).toMatchObject({
        remaining: 5,
        pendingGrowth: { total: 3, byGate: { prd_audit: 3 }, projected: 5 },
      });

      const lapsOnlyHuman: string[] = [];
      const lapsOnlyJson: string[] = [];
      for (const [format, output] of [['human', lapsOnlyHuman], ['json', lapsOnlyJson]] as const) {
        expect(await dispatchKickbackBudgetCommand(
          { kind: 'kickback-budget', action: 'inspect', feature: 'feature', format },
          { cwd: lapsOnlyFixture.root, resolveMainRoot: async () => lapsOnlyFixture.root, print: (line) => output.push(line) },
        )).toBe(0);
      }
      expect(lapsOnlyHuman[0]).not.toContain('Pending growth:');
      expect(JSON.stringify(JSON.parse(lapsOnlyJson[0]))).not.toContain('pendingGrowth');
    } finally {
      await Promise.all([pendingFixture.root, lapsOnlyFixture.root].map((root) => rm(root, { recursive: true, force: true })));
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
