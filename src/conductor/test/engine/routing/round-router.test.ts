// Covers: tasks:26,28,29,30,31,32
import { describe, expect, it, vi } from 'vitest';

import type { CriterionBoundRemediationGap } from '../../../src/engine/remediation-append.js';
import type { GitRunner } from '../../../src/engine/rebase.js';
import { routeAdmittedRound } from '../../../src/engine/routing/round-router.js';

const gap = (id: string, taskId: string, disposition: CriterionBoundRemediationGap['disposition'] = 'append-task'): CriterionBoundRemediationGap => ({
  id, disposition, category: null, rationale: `${id} rationale`, criterion: `${id} criterion`,
  tasks: [{ id: taskId, title: `${taskId} repair` }],
});

const git: GitRunner = async (args) => {
  if (args[0] === 'ls-tree') return { exitCode: 0, stdout: '', stderr: '' };
  return { exitCode: 0, stdout: '', stderr: '' };
};

const input = (admitted: Parameters<typeof routeAdmittedRound>[0]['admitted']) => ({
  admitted,
  envelope: { sliceMembership: { taskSlices: { T1: 1, T2: 2, T3: 3 }, titles: ['one', 'two', 'three'] } },
  planText: '', appendedChildren: {}, declaredPositions: [1, 2, 3] as const,
  leafTip: 'feat/daemon-demo', roundId: 'r1' as const, git,
});

describe('routeAdmittedRound', () => {
  it('places task-bound work mechanically and orders its hosts', async () => {
    const judge = vi.fn();
    const routed = await routeAdmittedRound({
      ...input([
        { id: 'one', gap: gap('one', 'T1'), gateSource: 'prd-audit', taskIds: ['T1'] },
        { id: 'three', gap: gap('three', 'T3'), gateSource: 'prd-audit', taskIds: ['T3'] },
      ]), judge,
    });
    expect(routed).toMatchObject({ kind: 'routed', hosts: [1, 3] });
    if (routed.kind !== 'routed') throw new Error(routed.detail);
    expect(routed.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ findingId: 'one', owner: 1, host: 1, reason: 'task-slice' }),
      expect.objectContaining({ findingId: 'three', owner: 3, host: 3, reason: 'task-slice' }),
    ]));
    expect(judge).not.toHaveBeenCalled();
  });

  it('halts before allocation when task ownership or a tree is unavailable', async () => {
    const missingOwner = await routeAdmittedRound({
      ...input([{ id: 'missing', gap: gap('missing', 'T9'), gateSource: 'prd-audit', taskIds: ['T9'] }]),
    });
    expect(missingOwner).toMatchObject({ kind: 'halt', detail: expect.stringContaining('T9') });

    const unreadable: GitRunner = async (args) => args[0] === 'ls-tree'
      ? { exitCode: 1, stdout: '', stderr: 'missing tree' }
      : git(args);
    const missingTree = await routeAdmittedRound({
      ...input([{ id: 'one', gap: gap('one', 'T1'), gateSource: 'prd-audit', taskIds: ['T1'], citedPaths: ['src/a.ts'] }]), git: unreadable,
    });
    expect(missingTree).toMatchObject({ kind: 'halt', detail: expect.stringContaining('feat/daemon-demo') });
  });

  it('halts residue routing after two invalid answers without allocating work', async () => {
    const judge = vi.fn<(prompt: string) => Promise<{ success: boolean; output: string }>>(async () => ({ success: true, output: 'not JSON' }));
    const routed = await routeAdmittedRound({
      ...input([{ id: 'adr-d2', gap: gap('adr-d2', 'unused'), gateSource: 'as-built', residue: true }]), judge,
    });
    expect(routed).toMatchObject({ kind: 'halt', detail: expect.stringContaining('adr-d2') });
    expect(judge).toHaveBeenCalledTimes(2);
  });

  it('makes a mixed FAIL obligation durable at the lowest task-owned host', async () => {
    const judge = vi.fn();
    const routed = await routeAdmittedRound({
      ...input([
        { id: 'two', gap: gap('two', 'T2'), gateSource: 'prd-audit', taskIds: ['T2'] },
        { id: 'three', gap: gap('three', 'T3'), gateSource: 'prd-audit', taskIds: ['T3'], existingTask: true },
      ]),
      judge, consolidatedManualTestFail: ['manual_test: FAIL row one', 'manual_test: FAIL row two'],
    });
    if (routed.kind !== 'routed') throw new Error(routed.detail);
    expect(judge).not.toHaveBeenCalled();
    expect(routed.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ findingId: 'manual-test-fail', owner: 2, host: 2, reason: 'mixed-round', restage: false }),
      expect.objectContaining({ findingId: 'three', owner: 3, host: 3, restage: false }),
    ]));
    expect(routed.hostHints[2]).toContain('manual_test: FAIL row one');
    expect(routed.hostHints[3]).toContain('manual_test: FAIL row two');
    expect(routed.allocation[2]?.retryHint).toBe(routed.hostHints[2]);
  });
});
