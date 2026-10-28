// Covers: task:32
import { describe, expect, it } from 'vitest';

import { formatOperatorHaltReason, parseOperatorHaltReason } from '../../src/engine/routing/operator-round.js';
import { parseRoundId } from '../../src/engine/routing/route-types.js';

describe('stack land --done refusals', () => {
  it('retains a round-scoped refusal identity without mutating the halt reason', () => {
    const roundId = parseRoundId('r1')!;
    const reason = formatOperatorHaltReason('operator-round-undeclared', roundId);
    expect(parseOperatorHaltReason(reason)).toEqual({ reason: 'operator-round-undeclared', roundId });
  });
});
