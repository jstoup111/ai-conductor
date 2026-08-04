import { describe, expect, it } from 'vitest';

import { evaluateConductStateMutation } from '../../src/engine/conduct-state-conflicts.js';
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
      name: 'resolves a stale removal of terminal feature completion',
      currentValue: 'complete',
      mutation: {
        field: 'feature_status',
        expected: undefined,
        intent: 'clear stale feature status',
        next: undefined,
      },
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
