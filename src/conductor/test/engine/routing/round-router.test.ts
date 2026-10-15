// Covers: tasks:26,28,29,30,31,32, task:rem-prd-audit-W2, task:rem-prd-audit-W4, task:rem-as-built-W3
import { describe, expect, it, vi } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import type { CriterionBoundRemediationGap } from '../../../src/engine/remediation-append.js';
import type { GitRunner } from '../../../src/engine/rebase.js';
import { routeAdmittedRound } from '../../../src/engine/routing/round-router.js';
import type { RoundId } from '../../../src/engine/routing/route-types.js';

const c1 = parseChildId(1)!;
const c2 = parseChildId(2)!;
const c3 = parseChildId(3)!;

const gap = (id: string, taskId: string, disposition: CriterionBoundRemediationGap['disposition'] = 'build'): CriterionBoundRemediationGap => ({
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
  planText: '', appendedChildren: {}, declaredPositions: [c1, c2, c3] as const,
  leafTip: 'feat/daemon-demo', roundId: 'r1' as RoundId, git,
});

describe('routeAdmittedRound', () => {
  it('places task-bound work mechanically and orders its hosts', async () => {
    const judge = vi.fn();
    const routed = await routeAdmittedRound({
      ...input([
        { id: 'one', gap: gap('one', 'T1'), gateSource: 'prd-audit', ownerTaskIds: ['T1'], citedPaths: [], provenance: { kind: 'task-bound' } },
        { id: 'three', gap: gap('three', 'T3'), gateSource: 'prd-audit', ownerTaskIds: ['T3'], citedPaths: [], provenance: { kind: 'task-bound' } },
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

  // Covers: task:rem-as-built-W3
  it('routes a repair task through its admitted parent binding rather than its proposed id', async () => {
    const routed = await routeAdmittedRound({
      ...input([{
        id: 'repair-for-one',
        gap: gap('repair-for-one', 'rem-prd-audit-T2'),
        gateSource: 'prd-audit',
        ownerTaskIds: ['T1'],
        citedPaths: [],
        provenance: { kind: 'task-bound' },
      }]),
    });

    expect(routed).toMatchObject({ kind: 'routed', hosts: [1] });
    if (routed.kind !== 'routed') throw new Error(routed.detail);
    expect(routed.items).toEqual([
      expect.objectContaining({ findingId: 'repair-for-one', owner: 1, host: 1, reason: 'task-slice' }),
    ]);
  });

  it('halts before allocation when task ownership or a tree is unavailable', async () => {
    const missingBinding = await routeAdmittedRound({
      ...input([{ id: 'unbound', gap: gap('unbound', 'T1'), gateSource: 'prd-audit', citedPaths: [], provenance: { kind: 'task-bound' } }]),
    });
    expect(missingBinding).toMatchObject({ kind: 'halt', detail: expect.stringContaining('admitted owner-task binding') });

    const missingOwner = await routeAdmittedRound({
      ...input([{ id: 'missing', gap: gap('missing', 'T9'), gateSource: 'prd-audit', ownerTaskIds: ['T9'], citedPaths: [], provenance: { kind: 'task-bound' } }]),
    });
    expect(missingOwner).toMatchObject({ kind: 'halt', detail: expect.stringContaining('T9') });

    const unreadable: GitRunner = async (args) => args[0] === 'ls-tree'
      ? { exitCode: 1, stdout: '', stderr: 'missing tree' }
      : git(args);
    const missingTree = await routeAdmittedRound({
      ...input([{ id: 'one', gap: gap('one', 'T1'), gateSource: 'prd-audit', ownerTaskIds: ['T1'], citedPaths: ['src/a.ts'], provenance: { kind: 'task-bound' } }]), git: unreadable,
    });
    expect(missingTree).toMatchObject({ kind: 'halt', detail: expect.stringContaining('feat/daemon-demo') });
  });

  it('halts residue routing after two invalid answers without allocating work', async () => {
    const judge = vi.fn<(prompt: string) => Promise<{ success: boolean; output: string }>>(async () => ({ success: true, output: 'not JSON' }));
    const routed = await routeAdmittedRound({
      ...input([{
        id: 'adr-d2', gap: gap('adr-d2', 'unused'), gateSource: 'as-built', citedPaths: [],
        provenance: { kind: 'as-built', reference: { kind: 'adr-decision', stem: 'adr-d2', decision: 2 }, summary: 'ADR-only finding' },
      }]), judge,
    });
    expect(routed).toMatchObject({ kind: 'halt', detail: expect.stringContaining('adr-d2') });
    expect(judge).toHaveBeenCalledTimes(2);
  });

  it('makes a mixed FAIL obligation durable at the lowest task-owned host without allocating an existing-task block', async () => {
    const judge = vi.fn();
    const routed = await routeAdmittedRound({
      ...input([
        { id: 'two', gap: gap('two', 'T2'), gateSource: 'prd-audit', ownerTaskIds: ['T2'], citedPaths: [], provenance: { kind: 'task-bound' } },
        { id: 'three', gap: gap('three', 'T3'), gateSource: 'prd-audit', ownerTaskIds: ['T3'], citedPaths: [], existingTask: true, provenance: { kind: 'task-bound' } },
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
    expect(routed.hostHints[3]).toContain('three rationale');
    expect(routed.allocation[c2]?.retryHint).toBe(routed.hostHints[2]);
    expect(routed.allocation[c3]).toMatchObject({ remTaskIds: [], blockBodies: [] });
  });

  it('hosts mixed FAIL rows with task-bound work rather than a lower residue host', async () => {
    const judge = vi.fn(async () => ({
      success: true,
      output: JSON.stringify({
        version: 'v1',
        items: [{ itemId: 'adr-d1', child: 1, candidates: [1], rationale: 'The ADR applies to child one.' }],
      }),
    }));
    const failRows = ['manual_test: FAIL row one\n  observed detail', 'manual_test: FAIL row two'];
    const routed = await routeAdmittedRound({
      ...input([
        {
          id: 'adr-d1', gap: gap('adr-d1', 'repair-adr'), gateSource: 'as-built', citedPaths: [],
          provenance: {
            kind: 'as-built',
            reference: { kind: 'adr-decision', stem: 'adr-boundary', decision: 1 },
            summary: 'The ADR is not wired.',
          },
        },
        { id: 'two', gap: gap('two', 'T2'), gateSource: 'prd-audit', ownerTaskIds: ['T2'], citedPaths: [], provenance: { kind: 'task-bound' } },
      ]),
      judge, consolidatedManualTestFail: failRows,
    });

    if (routed.kind !== 'routed') throw new Error(routed.detail);
    expect(routed.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ findingId: 'manual-test-fail', owner: 2, host: 2, reason: 'mixed-round', restage: false }),
    ]));
    for (const host of [1, 2]) {
      expect(routed.hostHints[host]).toContain(failRows[0]!);
      expect(routed.hostHints[host]).toContain(failRows[1]!);
      expect(routed.allocation[host as typeof c1]?.retryHint).toBe(routed.hostHints[host]);
    }
  });

  it('sends refusal rework with proposed tasks to the residue judge', async () => {
    const judge = vi.fn(async (prompt: string) => {
      const request = JSON.parse(prompt.slice(prompt.indexOf('{'))) as { items: Array<{ itemId: string; rationale: string; governingEvidence: string }> };
      expect(request.items).toEqual([{
        itemId: 'refusal-dec-1',
        rationale: 'Remove the refused behavior.',
        governingEvidence: 'Refused S2.1 (decision dec-1 r1)',
      }]);
      return {
        success: true,
        output: JSON.stringify({
          version: 'v1',
          items: [{ itemId: 'refusal-dec-1', child: 2, candidates: [2], rationale: 'Child two owns the refused behavior.' }],
        }),
      };
    });
    const refusalGap = {
      ...gap('refusal-dec-1', 'remove-refused'),
      rationale: 'Remove the refused behavior.',
      governingClause: 'Refused S2.1 (decision dec-1 r1)',
    };
    const routed = await routeAdmittedRound({
      ...input([{
        id: 'refusal-dec-1', gap: refusalGap, gateSource: 'prd-audit', citedPaths: [],
        provenance: { kind: 'refusal-rework', governingEvidence: refusalGap.governingClause },
      }]), judge,
    });

    expect(judge).toHaveBeenCalledTimes(1);
    if (routed.kind !== 'routed') throw new Error(routed.detail);
    expect(routed.items).toEqual([expect.objectContaining({ findingId: 'refusal-dec-1', owner: 2, host: 2, reason: 'residue-judged' })]);
    expect(routed.allocation[c1]).toBeUndefined();
    expect(routed.allocation[c2]?.remTaskIds).toEqual(['rem-prd-audit-refusal-dec-1']);
  });

  it('projects an ADR-only as-built finding and its evidence to the residue judge', async () => {
    const judge = vi.fn(async (prompt: string) => {
      const request = JSON.parse(prompt.slice(prompt.indexOf('{'))) as {
        items: Array<{ itemId: string; rationale: string; summary: string; governingEvidence: { kind: string; stem: string; decision: number } }>;
      };
      expect(request.items).toEqual([{
        itemId: 'as-built-1',
        rationale: 'Wire the boundary.',
        summary: 'The boundary is not wired.',
        governingEvidence: { kind: 'adr-decision', stem: 'adr-boundary', decision: 3 },
      }]);
      return {
        success: true,
        output: JSON.stringify({
          version: 'v1',
          items: [{ itemId: 'as-built-1', child: 2, candidates: [2], rationale: 'The ADR governs child two.' }],
        }),
      };
    });
    const asBuiltGap = { ...gap('as-built-1', 'wire-boundary'), rationale: 'Wire the boundary.' };
    const routed = await routeAdmittedRound({
      ...input([{
        id: 'as-built-1', gap: asBuiltGap, gateSource: 'as-built', citedPaths: [],
        provenance: {
          kind: 'as-built', reference: { kind: 'adr-decision', stem: 'adr-boundary', decision: 3 },
          summary: 'The boundary is not wired.',
        },
      }]), judge,
    });

    expect(judge).toHaveBeenCalledTimes(1);
    if (routed.kind !== 'routed') throw new Error(routed.detail);
    expect(routed.items).toEqual([expect.objectContaining({ findingId: 'as-built-1', owner: 2, host: 2, reason: 'residue-judged' })]);
  });
});
