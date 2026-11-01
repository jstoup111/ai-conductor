import { describe, expect, it } from 'vitest';

import {
  recordAsBuiltNeedsHuman,
  recordAsBuiltReconciliation,
  resolveOpenAsBuiltCases,
} from '../../src/engine/as-built-case-reconciliation.js';
import type { RemediationCaseStoreV4State } from '../../src/engine/remediation-case-store.js';

const FEATURE = { version: 'v1', repository: 'acme/conductor', feature: 'as-built-reconciliation' } as const;

const priorCase = {
  id: 'c1', domain: 'as_built' as const, status: 'resolved' as const,
  sources: [{
    findingId: 'as-built:attempt-1:1', attemptId: 'attempt-1', class: 'REMEDIABLE' as const,
    reference: { kind: 'plan-task' as const, taskId: '1' }, summary: 'The original contract gap.',
    relation: 'new' as const, reason: 'It had no prior case.',
  }],
  repairTaskIds: ['rem-as-built-t1'], recurrenceCount: 1,
};

function state(cases = [priorCase]): RemediationCaseStoreV4State {
  return { version: 'v4', feature: FEATURE, cases: [], prdWideningCases: [], asBuiltCases: cases, suppressions: [], outbox: [] };
}

const sources = [
  { findingId: 'as-built:attempt-2:1', attemptId: 'attempt-2', class: 'REMEDIABLE' as const, reference: { kind: 'plan-task' as const, taskId: '1' }, summary: 'The same contract gap.' },
  { findingId: 'as-built:attempt-2:2', attemptId: 'attempt-2', class: 'REMEDIABLE' as const, reference: { kind: 'plan-task' as const, taskId: '1' }, summary: 'The attempted repair regressed.' },
  { findingId: 'as-built:attempt-2:3', attemptId: 'attempt-2', class: 'REMEDIABLE' as const, reference: { kind: 'plan-task' as const, taskId: '2' }, summary: 'The defect has a materially different cause.' },
  { findingId: 'as-built:attempt-2:4', attemptId: 'attempt-2', class: 'REMEDIABLE' as const, reference: { kind: 'plan-task' as const, taskId: '3' }, summary: 'A new defect.' },
] as const;

describe('as-built case reconciliation', () => {
  it('joins same and recurrence sources and opens changed and new cases', () => {
    const result = recordAsBuiltReconciliation(state(), {
      results: [
        { source: sources[0], relation: 'same', priorCaseId: 'c1', reason: 'Same unresolved defect.' },
        { source: sources[1], relation: 'recurrence', priorCaseId: 'c1', reason: 'The attempted repair did not hold.' },
        { source: sources[2], relation: 'materially-changed', priorCaseId: 'c1', reason: 'A distinct cause now applies.', repairTaskIds: ['rem-as-built-t2'] },
        { source: sources[3], relation: 'new', reason: 'No prior case applies.', repairTaskIds: ['rem-as-built-t3'] },
      ],
      newCaseId: (() => { let number = 1; return () => `new-${number++}`; })(),
      newEventId: (() => { let number = 1; return () => `event-${number++}`; })(),
      occurredAt: '2026-10-29T12:00:00.000Z',
    });

    expect(result.state.asBuiltCases).toEqual([
      expect.objectContaining({ id: 'c1', status: 'open', recurrenceCount: 2, sources: [...priorCase.sources, expect.objectContaining({ findingId: sources[0].findingId, relation: 'same' }), expect.objectContaining({ findingId: sources[1].findingId, relation: 'recurrence' })] }),
      expect.objectContaining({ id: 'as-built-case:new-1', changedFrom: 'c1', repairTaskIds: ['rem-as-built-t2'], status: 'open', recurrenceCount: 1 }),
      expect.objectContaining({ id: 'as-built-case:new-2', repairTaskIds: ['rem-as-built-t3'], status: 'open', recurrenceCount: 1 }),
    ]);
    expect(result.recordedSources).toHaveLength(4);
  });

  it('writes one replay-safe outbox entry per source and converges on an identical replay', () => {
    const input = {
      results: [{ source: sources[0], relation: 'same' as const, priorCaseId: 'c1', reason: 'Same unresolved defect.' }],
      newCaseId: () => 'unused', newEventId: () => 'event-1', occurredAt: '2026-10-29T12:00:00.000Z',
    };
    const first = recordAsBuiltReconciliation(state(), input);
    expect(first.state.outbox).toEqual([expect.objectContaining({
      eventId: 'event-1', occurredAt: input.occurredAt,
      event: expect.objectContaining({ type: 'as_built_finding_reconciled', findingId: sources[0].findingId, caseId: 'c1', attemptId: 'attempt-2', outcome: 'same', priorCaseId: 'c1', reason: 'Same unresolved defect.' }),
    })]);

    const replay = recordAsBuiltReconciliation(first.state, input);
    expect(replay).toEqual({ state: first.state, recordedSources: [] });
  });

  it('records needs-human findings and resolves only open cases', () => {
    const needsHumanReason = 'The verdict cannot proceed without a human decision.';
    const needsHuman = recordAsBuiltNeedsHuman(state(), {
      findings: [sources[0], { findingId: 'as-built:attempt-2:5', attemptId: 'attempt-2', class: 'DESIGN', summary: 'A human must decide.' }],
      reason: needsHumanReason,
      newCaseId: (() => { let number = 1; return () => `human-${number++}`; })(),
      newEventId: (() => { let number = 1; return () => `event-human-${number++}`; })(),
      occurredAt: '2026-10-29T12:00:00.000Z',
    });
    expect(needsHuman.state.asBuiltCases.slice(1)).toEqual([
      expect.objectContaining({
        status: 'needs-human', repairTaskIds: [],
        sources: [expect.objectContaining({ findingId: sources[0].findingId, relation: 'needs-human', reason: needsHumanReason })],
      }),
      expect.objectContaining({
        status: 'needs-human', repairTaskIds: [],
        sources: [expect.objectContaining({ findingId: 'as-built:attempt-2:5', relation: 'needs-human', reason: needsHumanReason })],
      }),
    ]);
    expect(needsHuman.state.outbox).toEqual([
      expect.objectContaining({ event: expect.objectContaining({ findingId: sources[0].findingId, outcome: 'needs-human', reason: needsHumanReason }) }),
      expect.objectContaining({ event: expect.objectContaining({ findingId: 'as-built:attempt-2:5', outcome: 'needs-human', reason: needsHumanReason }) }),
    ]);
    expect(needsHuman.recordedSources).toHaveLength(2);

    const resolved = resolveOpenAsBuiltCases({ ...needsHuman.state, asBuiltCases: [
      { ...priorCase, status: 'open' as const },
      ...needsHuman.state.asBuiltCases.slice(1),
    ] });
    expect(resolved.state.asBuiltCases.map((item) => item.status)).toEqual(['resolved', 'needs-human', 'needs-human']);
    expect(resolved.recordedSources).toEqual([]);
  });
});
