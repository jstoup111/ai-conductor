// Covers: task:3, task:5
import { describe, expect, it } from 'vitest';
import {
  REMEDIATION_CLOSURE_JUDGEMENT_SCHEMA,
  remediationCloseIdentity,
  selectRemediationClosureCandidates,
  validateRemediationClosureOutput,
} from '../../src/engine/remediation-closure-judgement.js';

const candidateIds = ['rem-as-built-R5', 'rem-as-built-R11'];
const verdicts = [
  { taskId: 'rem-as-built-R5', verdict: 'resolved', rationale: 'The named repair is present.' },
  { taskId: 'rem-as-built-R11', verdict: 'partial', rationale: 'Only part of the named repair is present.' },
] as const;

describe('remediation closure judgement contract', () => {
  it('returns exactly one unchanged verdict for every candidate', () => {
    expect(validateRemediationClosureOutput({ verdicts }, candidateIds)).toEqual({ kind: 'valid', verdicts });
  });

  it.each([
    ['missing candidate id', { verdicts: [verdicts[0]] }],
    ['extra non-candidate task id', { verdicts: [...verdicts, { taskId: 'rem-as-built-R404', verdict: 'persists', rationale: 'Unexpected task.' }] }],
    ['additional verdict key', { verdicts: [{ ...verdicts[0], unexpected: true }, verdicts[1]] }],
    ['unknown verdict', { verdicts: [{ ...verdicts[0], verdict: 'unknown' }, verdicts[1]] }],
    ['empty rationale', { verdicts: [{ ...verdicts[0], rationale: '' }, verdicts[1]] }],
  ])('rejects a result with %s', (_name, output) => {
    expect(validateRemediationClosureOutput(output, candidateIds)).toMatchObject({ kind: 'invalid' });
  });

  it('exports a closed entry schema matching the verdict contract', () => {
    const entries = REMEDIATION_CLOSURE_JUDGEMENT_SCHEMA.properties.verdicts as {
      items: { additionalProperties: boolean; required: readonly string[]; properties: Record<string, unknown> };
    };
    expect(entries.items).toMatchObject({
      additionalProperties: false,
      required: ['taskId', 'verdict', 'rationale'],
      properties: {
        verdict: { enum: ['resolved', 'persists', 'partial'] },
        rationale: { minLength: 1 },
      },
    });
  });
});

describe('remediation closure candidates', () => {
  const closeRecords = [
    { check: 'The named repair is committed.', evidence: 'abc123', source: 'reported' },
    { check: 'Targeted tests pass.', evidence: 'test:repair.test.ts::passes', source: 'verified' },
  ] as const;

  it('keys a close by task, reopen count, and ordered check evidence only', () => {
    const identity = remediationCloseIdentity('rem-as-built-R5', 0, closeRecords);

    expect(remediationCloseIdentity('rem-as-built-R5', 0, [
      { ...closeRecords[0], source: 'unverified' },
      { ...closeRecords[1], source: 'operator-accepted' },
    ])).toBe(identity);
    expect(remediationCloseIdentity('rem-as-built-R5', 1, closeRecords)).not.toBe(identity);
    expect(remediationCloseIdentity('rem-as-built-R5', 0, [
      { ...closeRecords[0], check: 'A different check.' },
      closeRecords[1],
    ])).not.toBe(identity);
    expect(remediationCloseIdentity('rem-as-built-R5', 0, [
      { ...closeRecords[0], evidence: 'different evidence' },
      closeRecords[1],
    ])).not.toBe(identity);
  });

  it('selects only resolved, in-scope engine remediation closes without pending or citation work', () => {
    const status = {
      tasks: [
        { id: 'rem-as-built-R5', title: 'eligible', status: 'completed', commit: 'old-sha', startHead: 'old-head', doneWhen: closeRecords },
        { id: 'rem-as-built-R6', status: 'completed', doneWhen: closeRecords },
        { id: 'rem-as-built-R7', status: 'completed', doneWhen: [{ ...closeRecords[0], source: 'pending-judgement' }] },
        { id: 'rem-as-built-R8', status: 'completed', doneWhen: closeRecords },
        { id: 'rem-as-built-R9', status: 'pending', doneWhen: closeRecords },
        { id: 'ordinary-10', status: 'completed', doneWhen: closeRecords },
      ],
    };

    const selected = selectRemediationClosureCandidates({
      status,
      scopeTaskIds: ['rem-as-built-R5', 'rem-as-built-R7', 'rem-as-built-R8', 'rem-as-built-R9', 'ordinary-10'],
      resolvedIds: new Set(['rem-as-built-R5', 'rem-as-built-R6', 'rem-as-built-R7', 'rem-as-built-R8', 'ordinary-10']),
      state: {},
      openCitationTaskIds: new Set(['rem-as-built-R8']),
    });

    expect(selected).toEqual([expect.objectContaining({ taskId: 'rem-as-built-R5', title: 'eligible' })]);
  });

  it.each(['resolved', 'persists', 'partial', 'unjudged'] as const)(
    'excludes a close already carrying a %s verdict',
    (verdict) => {
      const identity = remediationCloseIdentity('rem-as-built-R5', 0, closeRecords);
      expect(selectRemediationClosureCandidates({
        status: { tasks: [{ id: 'rem-as-built-R5', status: 'completed', doneWhen: closeRecords }] },
        scopeTaskIds: ['rem-as-built-R5'],
        resolvedIds: new Set(['rem-as-built-R5']),
        state: { 'rem-as-built-R5': { reopenCount: 0, verdicts: { [identity]: { verdict } } } },
        openCitationTaskIds: new Set(),
      })).toEqual([]);
    },
  );

  it('requires fresh Done-when records and gives a reclosed task a new identity after reopening', () => {
    const status = { tasks: [{
      id: 'rem-as-built-R5', status: 'completed', restored_from: 'task-trailer', doneWhen: [],
    }] };
    const input = {
      status,
      scopeTaskIds: ['rem-as-built-R5'],
      resolvedIds: new Set(['rem-as-built-R5']),
      state: { 'rem-as-built-R5': { reopenCount: 0, verdicts: {} } },
      openCitationTaskIds: new Set<string>(),
    };

    expect(selectRemediationClosureCandidates(input)).toEqual([]);
    status.tasks[0].doneWhen = [...closeRecords];
    const first = selectRemediationClosureCandidates(input);
    const reclosed = selectRemediationClosureCandidates({
      ...input,
      state: { 'rem-as-built-R5': { reopenCount: 1, verdicts: { [first[0]!.closeIdentity]: { verdict: 'persists' } } } },
    });
    expect(reclosed).toHaveLength(1);
    expect(reclosed[0]!.closeIdentity).not.toBe(first[0]!.closeIdentity);
  });
});
