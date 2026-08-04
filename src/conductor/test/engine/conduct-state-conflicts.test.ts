import { describe, expect, it } from 'vitest';

import {
  evaluateConductStateMutation,
  type StateMutationDiagnostic,
} from '../../src/engine/conduct-state-conflicts.js';
import type { StateMutation } from '../../src/engine/conduct-state-store.js';
import type { ConductState } from '../../src/types/state.js';

type ExpectedDisposition = 'applied' | 'idempotent' | 'resolved' | 'conflict';

type ConflictCase = {
  name: string;
  currentValue: unknown;
  mutation: StateMutation<ConductState>;
  disposition: ExpectedDisposition;
};

describe('evaluateConductStateMutation', () => {
  it.each<ConflictCase>([
    {
      name: 'applies when the expected value still matches current state',
      currentValue: 'S',
      mutation: {
        field: 'complexity_tier',
        expected: 'S',
        intent: 'record assessed complexity',
        next: 'M',
      },
      disposition: 'applied',
    },
    {
      name: 'returns idempotent when current already equals requested despite a stale expectation',
      currentValue: 'M',
      mutation: {
        field: 'complexity_tier',
        expected: 'S',
        intent: 'record assessed complexity',
        next: 'M',
      },
      disposition: 'idempotent',
    },
    {
      name: 'resolves a dynamically shaped stale removal of terminal feature completion',
      currentValue: 'complete',
      mutation: {
        field: 'feature_status',
        expected: undefined,
        intent: 'clear stale feature status',
        next: undefined,
      } as unknown as StateMutation<ConductState>,
      disposition: 'resolved',
    },
    {
      name: 'applies an explicit done-to-stale invalidation when done is expected',
      currentValue: 'done',
      mutation: {
        field: 'plan',
        expected: 'done',
        intent: 'invalidate superseded plan',
        next: 'stale',
      },
      disposition: 'applied',
    },
    {
      name: 'conflicts when a done-to-stale invalidation has a stale expectation',
      currentValue: 'done',
      mutation: {
        field: 'plan',
        expected: 'pending',
        intent: 'invalidate superseded plan',
        next: 'stale',
      },
      disposition: 'conflict',
    },
    {
      name: 'conflicts for an unruled field mismatch',
      currentValue: 'M',
      mutation: {
        field: 'complexity_tier',
        expected: 'S',
        intent: 'record assessed complexity',
        next: 'L',
      },
      disposition: 'conflict',
    },
  ])('$name', ({ currentValue, mutation, disposition }) => {
    const result = evaluateConductStateMutation(currentValue, mutation);

    if (disposition === 'conflict') {
      expect(result).toMatchObject({ kind: 'conflict' });
      if (result.kind === 'conflict') {
        expect(result.message).toContain(mutation.field);
      }
      return;
    }

    expect(result).toEqual({ kind: disposition });
  });
});

describe('state mutation diagnostics', () => {
  it('emits a structured, redacted conflict diagnostic without raw unbounded values', () => {
    const diagnostics: StateMutationDiagnostic[] = [];
    const secret = `Bearer ${'s'.repeat(2_048)}`;
    const result = evaluateConductStateMutation('existing description', {
      field: 'feature_desc',
      expected: secret,
      intent: 'record feature description',
      next: 'replacement description',
    }, {
      writer: 'conductor',
      emit: (diagnostic) => diagnostics.push(diagnostic),
    });

    expect(result).toMatchObject({ kind: 'conflict' });
    expect(diagnostics).toEqual([{
      field: 'feature_desc',
      writer: 'conductor',
      intent: 'record feature description',
      disposition: 'conflict',
      expected: { kind: 'string', length: 256, redacted: true, truncated: true },
      current: { kind: 'string', length: 20, redacted: true, truncated: false },
      next: { kind: 'string', length: 23, redacted: true, truncated: false },
    }]);
    expect(JSON.stringify(diagnostics)).not.toContain(secret);
    expect(JSON.stringify(diagnostics)).not.toContain('Bearer');
  });

  it('emits the same safe diagnostic shape when terminal completion resolves a mutation', () => {
    const diagnostics: StateMutationDiagnostic[] = [];
    const result = evaluateConductStateMutation('complete', {
      field: 'feature_status',
      expected: undefined,
      intent: 'clear stale feature status',
      next: undefined,
    } as unknown as StateMutation<ConductState>, {
      writer: 'filesystem-conduct-state-store',
      emit: (diagnostic) => diagnostics.push(diagnostic),
    });

    expect(result).toEqual({ kind: 'resolved' });
    expect(diagnostics).toEqual([{
      field: 'feature_status',
      writer: 'filesystem-conduct-state-store',
      intent: 'clear stale feature status',
      disposition: 'resolved',
      expected: { kind: 'undefined' },
      current: { kind: 'string', length: 8, redacted: true, truncated: false },
      next: { kind: 'undefined' },
    }]);
  });
});
