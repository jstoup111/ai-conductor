// Covers: task:207
import { describe, expect, it } from 'vitest';

import {
  bypassesAcceptanceDispatch,
  permitsAcceptanceRedSelfHeal,
  type AcceptancePreDispatchOutcome,
} from '../../src/engine/acceptance-pre-dispatch.js';

describe('acceptance_specs pre-dispatch outcome', () => {
  it('distinguishes a refused routed verify-green from a healed or verified pass', () => {
    const refused: AcceptancePreDispatchOutcome = { kind: 'routed-refused' };
    const settled: readonly AcceptancePreDispatchOutcome[] = [{ kind: 'red-healed' }, { kind: 'routed-verified' }];
    expect(settled.map((outcome) => outcome.kind)).not.toContain(refused.kind);

    // A refusal is an attempted routed pass: it suppresses the RED self-heal
    // and the dispatch loop exactly as a successful pre-dispatch does.
    for (const outcome of [refused, ...settled]) {
      expect(permitsAcceptanceRedSelfHeal(outcome), outcome.kind).toBe(false);
      expect(bypassesAcceptanceDispatch(outcome), outcome.kind).toBe(true);
    }
  });

  it('leaves an unattempted pass free to self-heal RED and dispatch normally', () => {
    const outcome: AcceptancePreDispatchOutcome = { kind: 'not-attempted' };
    expect(permitsAcceptanceRedSelfHeal(outcome)).toBe(true);
    expect(bypassesAcceptanceDispatch(outcome)).toBe(false);
  });
});
